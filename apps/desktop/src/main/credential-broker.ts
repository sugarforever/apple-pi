import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type CredentialPersistence = "persistent" | "session";

export interface CredentialMetadata {
  providerId: string;
  kind: "api_key";
  persistence: CredentialPersistence;
  updatedAt: string;
}

export interface ProtectedStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  selectedBackend(): string;
}

interface StoredCredential {
  kind: "api_key";
  ciphertext: string;
  updatedAt: string;
}

interface CredentialDocument {
  version: 1;
  credentials: Record<string, StoredCredential>;
}

export class CredentialFile {
  constructor(private readonly filePath: string) {}

  async read(): Promise<CredentialDocument> {
    let text: string;
    try { text = await readFile(this.filePath, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyDocument();
      throw error;
    }
    const value: unknown = JSON.parse(text);
    if (!isCredentialDocument(value)) throw new Error("Credential store is invalid");
    return value;
  }

  async write(document: CredentialDocument): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }

  async remove(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}

export class CredentialBroker {
  private readonly sessionCredentials = new Map<string, { value: string; updatedAt: string }>();
  private document: CredentialDocument = emptyDocument();
  private persistence: CredentialPersistence = "session";
  private initialized = false;

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly storage: ProtectedStorage,
    private readonly file: CredentialFile,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async initialize(): Promise<void> {
    this.persistence = storagePolicy(this.platform, this.storage);
    this.document = await this.file.read();
    this.initialized = true;
  }

  storagePersistence(): CredentialPersistence { this.assertInitialized(); return this.persistence; }

  list(): CredentialMetadata[] {
    this.assertInitialized();
    const persisted = this.persistence === "persistent" ? Object.entries(this.document.credentials).map(([providerId, item]) => ({
      providerId, kind: item.kind, persistence: "persistent" as const, updatedAt: item.updatedAt,
    })) : [];
    const session = [...this.sessionCredentials].map(([providerId, item]) => ({
      providerId, kind: "api_key" as const, persistence: "session" as const, updatedAt: item.updatedAt,
    }));
    return [...persisted.filter((item) => !this.sessionCredentials.has(item.providerId)), ...session];
  }

  async setApiKey(providerId: string, apiKey: string): Promise<CredentialMetadata> {
    this.assertInitialized();
    assertProviderId(providerId);
    if (!apiKey) throw new Error("Credential must not be empty");
    const updatedAt = this.now().toISOString();
    if (this.persistence === "session") {
      await this.removePersisted(providerId);
      this.sessionCredentials.set(providerId, { value: apiKey, updatedAt });
      return { providerId, kind: "api_key", persistence: "session", updatedAt };
    }
    const ciphertext = this.storage.encryptString(apiKey).toString("base64");
    const next = { ...this.document, credentials: { ...this.document.credentials, [providerId]: { kind: "api_key" as const, ciphertext, updatedAt } } };
    await this.file.write(next);
    this.document = next;
    this.sessionCredentials.delete(providerId);
    return { providerId, kind: "api_key", persistence: "persistent", updatedAt };
  }

  async withApiKey<T>(providerId: string, use: (apiKey: string) => Promise<T>): Promise<T | undefined> {
    this.assertInitialized();
    const session = this.sessionCredentials.get(providerId);
    if (session) return use(session.value);
    if (this.persistence !== "persistent") return undefined;
    const stored = this.document.credentials[providerId];
    if (!stored) return undefined;
    let plaintext: string | undefined;
    try {
      plaintext = this.storage.decryptString(Buffer.from(stored.ciphertext, "base64"));
      return await use(plaintext);
    } finally {
      // eslint-disable-next-line no-useless-assignment -- deliberate best-effort scrub of the decrypted secret
      plaintext = undefined;
    }
  }

  async delete(providerId: string): Promise<boolean> {
    this.assertInitialized();
    const removedSession = this.sessionCredentials.delete(providerId);
    if (!this.document.credentials[providerId]) return removedSession;
    await this.removePersisted(providerId);
    return true;
  }

  private async removePersisted(providerId: string): Promise<void> {
    const credentials = { ...this.document.credentials };
    delete credentials[providerId];
    const next = { ...this.document, credentials };
    if (Object.keys(credentials).length === 0) await this.file.remove();
    else await this.file.write(next);
    this.document = next;
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error("Credential broker is not initialized");
  }
}

export function storagePolicy(platform: NodeJS.Platform, storage: ProtectedStorage): CredentialPersistence {
  if (platform === "linux") {
    const backend = storage.selectedBackend();
    if (!storage.isEncryptionAvailable()) return "session";
    return ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(backend) ? "persistent" : "session";
  }
  if ((platform === "darwin" || platform === "win32") && storage.isEncryptionAvailable()) return "persistent";
  throw new Error("OS-protected credential storage is unavailable");
}

function emptyDocument(): CredentialDocument { return { version: 1, credentials: {} }; }

function assertProviderId(value: string): void {
  // Control characters are exactly what this rejects: they would corrupt the
  // provider identifier wherever it is later used as a key.
  // eslint-disable-next-line no-control-regex
  if (!value || value.length > 160 || /[\u0000-\u001f]/.test(value)) throw new Error("Invalid provider identifier");
}

function isCredentialDocument(value: unknown): value is CredentialDocument {
  if (!value || typeof value !== "object") return false;
  const record = value as { version?: unknown; credentials?: unknown };
  if (record.version !== 1 || !record.credentials || typeof record.credentials !== "object" || Array.isArray(record.credentials)) return false;
  return Object.entries(record.credentials).every(([providerId, item]) => {
    if (!providerId || !item || typeof item !== "object") return false;
    const credential = item as Partial<StoredCredential>;
    return credential.kind === "api_key" && typeof credential.ciphertext === "string" && credential.ciphertext.length > 0
      && typeof credential.updatedAt === "string" && Number.isFinite(Date.parse(credential.updatedAt));
  });
}
