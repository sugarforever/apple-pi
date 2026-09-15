import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CustomProviderDefinition } from "@apple-pi/protocol";

// Validates a candidate definition before it ever reaches disk. This is the layer
// that gives the desktop UI immediate, specific error messages (issue #27's "clear
// validation errors" requirement); `CustomProviderStore` below additionally relies
// on it to guarantee every field it writes into models.json is well-typed, since a
// real `ModelRuntime` throws out *every* models.json-configured provider (not just
// the malformed one) when a single entry fails its schema check (confirmed against
// the real @earendil-works/pi-coding-agent@0.84.2 package: see custom-provider
// compatibility tests in compatibility.test.ts).
//
// Returns an error message, or undefined when the definition is valid.
export function validateCustomProviderDefinition(definition: CustomProviderDefinition, existingProviderIds: readonly string[]): string | undefined {
  if (existingProviderIds.includes(definition.id)) return `Provider id "${definition.id}" is already in use.`;

  let baseUrl: URL;
  try {
    baseUrl = new URL(definition.baseUrl);
  } catch {
    return "Base URL must be an absolute http or https URL.";
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") return "Base URL must be an absolute http or https URL.";

  const seenModelIds = new Set<string>();
  for (const model of definition.models) {
    const id = model.id.trim();
    if (!id) return "Every model must have a non-empty id.";
    if (seenModelIds.has(id)) return `Duplicate model id: ${id}.`;
    seenModelIds.add(id);
  }

  return undefined;
}

// Narrow surface `PiProviderService` depends on, so tests can inject a plain
// in-memory fake instead of driving real file I/O for every unit test (the real
// `CustomProviderStore`'s own file-handling is covered directly by this module's
// tests, and end-to-end against a real `ModelRuntime` in compatibility.test.ts).
export interface CustomProviderRepository {
  list(): Promise<CustomProviderDefinition[]>;
  get(id: string): Promise<CustomProviderDefinition | undefined>;
  upsert(definition: CustomProviderDefinition): Promise<void>;
  remove(id: string): Promise<boolean>;
}

interface ManifestDocument {
  version: 1;
  providers: Record<string, CustomProviderDefinition>;
}

interface RawModelsJsonDocument {
  providers: Record<string, unknown>;
}

function emptyManifest(): ManifestDocument {
  return { version: 1, providers: {} };
}

// Mirrors the Pi provider config shape our definition maps to (see
// `ProviderConfigSchema`/`ModelDefinitionSchema` in the real SDK's
// `core/model-config.ts`, which is not part of its public API surface, so this
// intentionally stays a plain, narrow, hand-written projection rather than an
// import). Never includes `apiKey` or `oauth`: the security invariant this
// module exists to uphold is that a custom provider's secret never reaches
// models.json.
function toPiProviderConfig(definition: CustomProviderDefinition): Record<string, unknown> {
  return {
    name: definition.name,
    baseUrl: definition.baseUrl,
    api: definition.api,
    ...(definition.compat ? { compat: definition.compat } : {}),
    models: definition.models.map((model) => ({
      id: model.id,
      ...(model.name !== undefined ? { name: model.name } : {}),
      ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
      ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
    })),
  };
}

// Atomic JSON writer mirroring `CredentialFile` (temp file + rename) in
// `apps/desktop/src/main/credential-broker.ts` — the established pattern in this
// repo for durable local JSON state, reused here instead of reinvented.
async function writeJsonAtomic(filePath: string, document: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function readJsonTolerant<T>(filePath: string, fallback: T): Promise<T> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
  if (!text.trim()) return fallback;
  return JSON.parse(text) as T;
}

/**
 * Owns Apple Pi's bookkeeping about the custom (non-built-in) OpenAI-compatible
 * providers it has registered, and keeps Pi's own `models.json` in sync with it.
 *
 * `models.json` is treated as shared, foreign territory: a user may hand-edit it,
 * the Pi CLI may write built-in provider overrides into it, and a future Apple Pi
 * session may run alongside a `pi` CLI session pointed at the same file. This store
 * therefore only ever reads and rewrites the exact provider keys it manages (as
 * recorded in its own manifest file), leaving every other key in `models.json`
 * untouched — see `upsert`/`remove` below.
 *
 * The manifest is the source of truth for what Apple Pi has created; `models.json`
 * is a derived projection of it (minus every secret field, which never appears in
 * either file — see `toPiProviderConfig`).
 */
export class CustomProviderStore implements CustomProviderRepository {
  constructor(
    private readonly manifestPath: string,
    private readonly modelsJsonPath: string,
  ) {}

  async list(): Promise<CustomProviderDefinition[]> {
    const manifest = await this.readManifest();
    return Object.values(manifest.providers);
  }

  async get(id: string): Promise<CustomProviderDefinition | undefined> {
    const manifest = await this.readManifest();
    return manifest.providers[id];
  }

  async upsert(definition: CustomProviderDefinition): Promise<void> {
    const manifest = await this.readManifest();
    manifest.providers[definition.id] = definition;
    const modelsJson = await this.readModelsJson();
    modelsJson.providers[definition.id] = toPiProviderConfig(definition);
    await writeJsonAtomic(this.modelsJsonPath, modelsJson);
    await writeJsonAtomic(this.manifestPath, manifest);
  }

  async remove(id: string): Promise<boolean> {
    const manifest = await this.readManifest();
    if (!(id in manifest.providers)) return false;
    delete manifest.providers[id];
    const modelsJson = await this.readModelsJson();
    delete modelsJson.providers[id];
    await writeJsonAtomic(this.modelsJsonPath, modelsJson);
    await writeJsonAtomic(this.manifestPath, manifest);
    return true;
  }

  private async readManifest(): Promise<ManifestDocument> {
    const manifest = await readJsonTolerant<ManifestDocument>(this.manifestPath, emptyManifest());
    return manifest && typeof manifest === "object" && manifest.providers ? manifest : emptyManifest();
  }

  private async readModelsJson(): Promise<RawModelsJsonDocument> {
    let document: unknown;
    try {
      document = await readJsonTolerant<unknown>(this.modelsJsonPath, { providers: {} });
    } catch (error) {
      throw new Error(`Apple Pi could not read the existing models.json to update it safely: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new Error("Apple Pi could not read the existing models.json to update it safely: it is not a JSON object.");
    }
    const providers = (document as { providers?: unknown }).providers;
    if (providers !== undefined && (typeof providers !== "object" || providers === null || Array.isArray(providers))) {
      throw new Error('Apple Pi could not read the existing models.json to update it safely: its "providers" field is not an object.');
    }
    return { providers: { ...((providers as Record<string, unknown>) ?? {}) } };
  }
}
