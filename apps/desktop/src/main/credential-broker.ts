import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { log } from "./logger.js";

export type CredentialPersistence = "persistent" | "session";

/**
 * Why the credential store is not operating at full strength. Surfaced to the
 * user as a diagnostic and to the log as a support signal.
 */
export type CredentialStorageIssue = "os_protection_unavailable" | "store_quarantined";

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
    // 0700 is best effort: `mode` only applies to directories this call creates,
    // so an existing userData directory keeps its permissions. The file itself is
    // always created 0600, which is what actually protects the ciphertext.
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }

  async remove(): Promise<void> {
    await rm(this.filePath, { force: true });
  }

  /**
   * Moves an unreadable store aside so the application can start. A corrupt
   * store cannot be decrypted anyway, so preserving it under a new name costs
   * nothing and keeps the evidence for support.
   */
  async quarantine(suffix: string): Promise<string> {
    const quarantinedPath = `${this.filePath}.corrupt-${suffix.replace(/[:.]/g, "-")}`;
    await rename(this.filePath, quarantinedPath);
    return quarantinedPath;
  }
}

export class CredentialBroker {
  private readonly sessionCredentials = new Map<string, { value: string; updatedAt: string }>();
  private document: CredentialDocument = emptyDocument();
  private persistence: CredentialPersistence = "session";
  private issue: CredentialStorageIssue | undefined;
  private initialized = false;
  /** Serializes store mutations; see {@link enqueue}. */
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly storage: ProtectedStorage,
    private readonly file: CredentialFile,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async initialize(): Promise<void> {
    this.persistence = storagePolicy(this.platform, this.storage);
    if (this.persistence === "session") this.issue = "os_protection_unavailable";
    try {
      this.document = await this.file.read();
    } catch (error) {
      // A store that cannot be parsed is already unusable: refusing to start
      // would not recover it, so set it aside and continue in memory only.
      this.issue = "store_quarantined";
      log.warn("credential store could not be read; setting it aside", { error });
      try {
        log.warn("quarantined credential store", { path: await this.file.quarantine(this.now().toISOString()) });
      } catch (quarantineError) {
        log.error("could not quarantine the credential store", { error: quarantineError });
      }
      this.document = emptyDocument();
    }
    this.initialized = true;
  }

  storagePersistence(): CredentialPersistence { this.assertInitialized(); return this.persistence; }

  /** Undefined when the store is operating normally. */
  storageIssue(): CredentialStorageIssue | undefined { this.assertInitialized(); return this.issue; }

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
    return this.enqueue(() => this.writeApiKey(providerId, apiKey));
  }

  private async writeApiKey(providerId: string, apiKey: string): Promise<CredentialMetadata> {
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
    return this.enqueue(() => this.removeKey(providerId));
  }

  private async removeKey(providerId: string): Promise<boolean> {
    const removedSession = this.sessionCredentials.delete(providerId);
    if (!this.document.credentials[providerId]) return removedSession;
    await this.removePersisted(providerId);
    return true;
  }

  /**
   * Runs store mutations one at a time. Every mutation is a read-modify-write of
   * `this.document`, so two overlapping calls — for example connecting two
   * providers at once — would otherwise both write from the same base and drop
   * one of the credentials. Callers must not nest `enqueue`.
   */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(operation, operation);
    this.writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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

/**
 * Decides where a credential may be stored. Persistent storage is chosen only
 * when the operating system provides real protection for it.
 *
 * This never throws, and that is deliberate. A credential store that cannot be
 * encrypted is a reason to keep credentials in memory for this session; it is
 * never a reason to refuse to start the application. Failing closed here means
 * "do not write to disk", which `session` already guarantees — refusing to
 * launch would only turn a denied keychain prompt into a broken install.
 */
export function storagePolicy(platform: NodeJS.Platform, storage: ProtectedStorage): CredentialPersistence {
  if (platform === "linux") {
    if (!storage.isEncryptionAvailable()) return "session";
    // `basic_text` is Electron's unencrypted backend; it is not protected storage.
    return ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(storage.selectedBackend()) ? "persistent" : "session";
  }
  return storage.isEncryptionAvailable() ? "persistent" : "session";
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
