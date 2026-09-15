import { join } from "node:path";
import type { CredentialSource, ModelCatalogRefreshResult, ModelItem, ProviderDiagnostic, ProviderItem, ProviderOperationResult } from "@apple-pi/protocol";
import { getAgentDir, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { mapPiModel } from "./mappers.js";

interface RuntimeProvider {
  id: string;
  name: string;
  auth: { apiKey?: unknown; oauth?: unknown };
}

// Mirrors the "source" values a real ModelRuntime.getProviderAuthStatus() reports:
// "stored" (auth.json), "runtime" (an Apple-Pi-injected key), "environment" (a
// resolved ambient/`$VAR` reference), "fallback" (an SDK-registered extension key,
// unused by Apple Pi today), and the two models.json-configured shapes below.
type RuntimeAuthSource = "stored" | "runtime" | "environment" | "fallback" | "models_json_key" | "models_json_command";

interface RuntimeLike {
  getProviders(): readonly RuntimeProvider[];
  getProvider(providerId: string): RuntimeProvider | undefined;
  getAvailableSnapshot(): readonly unknown[];
  getProviderAuthStatus(providerId: string): { configured: boolean; source?: RuntimeAuthSource | string };
  // Whether auth for this provider actually resolves to a usable value right now.
  // `getProviderAuthStatus().configured` can be true purely because an auth.json
  // entry exists, even when its value is a `$VARIABLE` reference this process
  // cannot resolve — this is the authoritative "does it actually work" check.
  hasConfiguredAuth(providerId: string): boolean;
  listCredentials(options?: { signal?: AbortSignal }): Promise<readonly { providerId: string; type: "api_key" | "oauth" }[]>;
  checkAuth(providerId: string, options?: { signal?: AbortSignal }): Promise<{ source?: string; type: "api_key" | "oauth" } | undefined>;
  getAuth(providerId: string, options?: { signal?: AbortSignal }): Promise<{ auth: { apiKey?: string } } | undefined>;
  setRuntimeApiKey(providerId: string, apiKey: string, options?: { signal?: AbortSignal }): Promise<void>;
  removeRuntimeApiKey(providerId: string, options?: { signal?: AbortSignal }): Promise<void>;
  logout(providerId: string, options?: { signal?: AbortSignal }): Promise<void>;
  refresh(options?: {
    allowNetwork?: boolean;
    providers?: readonly string[];
    force?: boolean;
    signal?: AbortSignal;
  }): Promise<{ aborted: boolean; errors: ReadonlyMap<string, Error> }>;
}

type OperationOutcome<T> = { state: "completed"; value: T } | { state: "cancelled" | "timed_out" | "failed" };

// Non-secret shape of an auth.json entry, read without resolving `$VARIABLE`
// references or executing `!command` values. See `readStoredCredential`.
interface RawCredential {
  type: "api_key" | "oauth";
  key?: string;
}

export class PiProviderService {
  private readonly operations = new Map<string, AbortController>();
  private inFlightRefresh?: Promise<ModelCatalogRefreshResult>;

  constructor(
    private readonly runtime: () => Promise<RuntimeLike>,
    private readonly request: typeof fetch = fetch,
    // Reads the Pi CLI's own auth.json directly, bypassing ModelRuntime's cached,
    // resolved view. Mirrors the same default path `ModelRuntime.create()` uses when
    // `PiSessionService` calls it with no options. Injectable so callers or tests
    // pointed at a non-default agent directory (or a temp fixture) stay consistent.
    private readonly rawCredential: (providerId: string) => RawCredential | undefined = (providerId) =>
      readStoredCredential(providerId, join(getAgentDir(), "auth.json")),
  ) {}

  async list(signal?: AbortSignal): Promise<ProviderItem[]> {
    const runtime = await this.runtime();
    const credentials = await runtime.listCredentials({ signal });
    const stored = new Map(credentials.map((item) => [item.providerId, item.type]));
    const availableCounts = new Map<string, number>();
    for (const model of runtime.getAvailableSnapshot() as Array<{ provider?: unknown }>) {
      if (typeof model.provider === "string") availableCounts.set(model.provider, (availableCounts.get(model.provider) ?? 0) + 1);
    }
    return runtime
      .getProviders()
      .map((provider) => this.describe(runtime, provider, stored, availableCounts))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async connectApiKey(providerId: string, apiKey: string, operationId: string, timeoutMs: number): Promise<ProviderOperationResult> {
    return this.providerOperation(providerId, operationId, timeoutMs, async (runtime, signal) => {
      const provider = runtime.getProvider(providerId);
      if (!provider) return providerNotFound();
      if (!provider.auth.apiKey)
        return { diagnostics: [diagnostic("authentication_failed", "This provider does not support API-key authentication.", "connect")] };
      await runtime.setRuntimeApiKey(providerId, apiKey, { signal });
      const verification = await this.verifyCredential(runtime, providerId, signal);
      if (verification) {
        await runtime.removeRuntimeApiKey(providerId, { signal }).catch(() => undefined);
        return { diagnostics: [verification] };
      }
      return { diagnostics: [] };
    });
  }

  async disconnect(providerId: string, operationId: string, timeoutMs: number): Promise<ProviderOperationResult> {
    return this.providerOperation(providerId, operationId, timeoutMs, async (runtime, signal) => {
      if (!runtime.getProvider(providerId)) return providerNotFound();
      const source = runtime.getProviderAuthStatus(providerId).source;
      if (source === "runtime") await runtime.removeRuntimeApiKey(providerId, { signal });
      else if (source === "stored") await runtime.logout(providerId, { signal });
      else if (source)
        return {
          diagnostics: [
            diagnostic("authentication_failed", "This credential is supplied by the environment and cannot be removed by Apple Pi.", "check_environment"),
          ],
        };
      return { diagnostics: [] };
    });
  }

  async verify(providerId: string, operationId: string, timeoutMs: number): Promise<ProviderOperationResult> {
    return this.providerOperation(providerId, operationId, timeoutMs, async (runtime, signal) => {
      if (!runtime.getProvider(providerId)) return providerNotFound();
      const auth = await runtime.checkAuth(providerId, { signal });
      if (!auth) return { diagnostics: [diagnostic("authentication_required", "No usable credential is configured for this provider.", "connect")] };
      const verification = await this.verifyCredential(runtime, providerId, signal);
      return { diagnostics: verification ? [verification] : [] };
    });
  }

  private async verifyCredential(runtime: RuntimeLike, providerId: string, signal: AbortSignal): Promise<ProviderDiagnostic | undefined> {
    // Pi's built-in auth check verifies configuration, not remote acceptance. DeepSeek
    // provides a read-only balance endpoint, so its acceptance path can verify without
    // consuming model tokens or exposing the key outside the isolated host.
    if (providerId !== "deepseek") return undefined;
    const apiKey = (await runtime.getAuth(providerId, { signal }))?.auth.apiKey;
    if (!apiKey) return diagnostic("authentication_required", "Enter a DeepSeek API key to connect.", "connect");
    try {
      const response = await this.request("https://api.deepseek.com/user/balance", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal,
      });
      if (response.ok) return undefined;
      if (response.status === 401 || response.status === 403)
        return diagnostic("authentication_failed", "DeepSeek rejected this API key. Check the key and try again.", "reconnect");
      return diagnostic("authentication_failed", "DeepSeek could not verify this API key. Try again in a moment.", "retry");
    } catch {
      if (signal.aborted) throw new DOMException("Operation aborted", "AbortError");
      return diagnostic("authentication_failed", "Apple Pi could not reach DeepSeek to verify the key. Check your connection and try again.", "retry");
    }
  }

  // A refresh already in flight always ends up reading the full current
  // provider/model list regardless of which providers it targeted, so a
  // second caller can safely join it instead of racing another network
  // round-trip. The joining caller's own operationId is never registered,
  // so it cannot independently cancel just its share of the join.
  async refresh(providerIds: string[] | undefined, operationId: string, timeoutMs: number): Promise<ModelCatalogRefreshResult> {
    if (this.inFlightRefresh) return this.inFlightRefresh;
    const refreshing = this.performRefresh(providerIds, operationId, timeoutMs);
    this.inFlightRefresh = refreshing;
    try {
      return await refreshing;
    } finally {
      if (this.inFlightRefresh === refreshing) this.inFlightRefresh = undefined;
    }
  }

  private async performRefresh(providerIds: string[] | undefined, operationId: string, timeoutMs: number): Promise<ModelCatalogRefreshResult> {
    const outcome = await this.run(operationId, timeoutMs, async (signal) => {
      const runtime = await this.runtime();
      const result = await runtime.refresh({ allowNetwork: true, force: true, ...(providerIds ? { providers: providerIds } : {}), signal });
      const diagnostics = [...result.errors.keys()].map(() => diagnostic("model_refresh_failed", "A provider model catalog could not be refreshed.", "retry"));
      return { providers: await this.list(signal), models: await this.models(), diagnostics };
    });
    if (outcome.state === "completed") return outcome.value;
    // The refresh attempt failed, timed out, or was cancelled: fall back to
    // whatever the runtime already has cached rather than wiping the catalog
    // the UI is currently showing.
    const cached = await this.cachedCatalog();
    return { ...cached, diagnostics: operationDiagnostics(outcome, "model_refresh_failed", "The model catalog could not be refreshed.") };
  }

  private async cachedCatalog(): Promise<{ providers: ProviderItem[]; models: ModelItem[] }> {
    try {
      return { providers: await this.list(), models: await this.models() };
    } catch {
      return { providers: [], models: [] };
    }
  }

  cancel(operationId: string): boolean {
    const operation = this.operations.get(operationId);
    if (!operation) return false;
    operation.abort();
    return true;
  }

  private async models(): Promise<ModelItem[]> {
    const runtime = await this.runtime();
    return (runtime.getAvailableSnapshot() as Parameters<typeof mapPiModel>[0][])
      .map(mapPiModel)
      .sort((a, b) => `${a.provider}/${a.name}`.localeCompare(`${b.provider}/${b.name}`));
  }

  private async providerOperation(
    providerId: string,
    operationId: string,
    timeoutMs: number,
    operation: (runtime: RuntimeLike, signal: AbortSignal) => Promise<Omit<ProviderOperationResult, "provider">>,
  ): Promise<ProviderOperationResult> {
    const outcome = await this.run(operationId, timeoutMs, async (signal) => {
      const result = await operation(await this.runtime(), signal);
      const provider = (await this.list(signal)).find((item) => item.id === providerId);
      return { ...(provider ? { provider } : {}), diagnostics: result.diagnostics };
    });
    if (outcome.state === "completed") return outcome.value;
    return { diagnostics: operationDiagnostics(outcome, "authentication_failed", "The provider operation failed.") };
  }

  private async run<T>(operationId: string, timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<OperationOutcome<T>> {
    if (this.operations.has(operationId)) return { state: "failed" };
    const controller = new AbortController();
    this.operations.set(operationId, controller);
    let timedOut = false;
    const aborted = new Promise<OperationOutcome<T>>((resolve) =>
      controller.signal.addEventListener(
        "abort",
        () => {
          resolve({ state: timedOut ? "timed_out" : "cancelled" });
        },
        { once: true },
      ),
    );
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const completed: Promise<OperationOutcome<T>> = operation(controller.signal).then(
        (value): OperationOutcome<T> => ({ state: "completed", value }),
        (): OperationOutcome<T> => ({ state: controller.signal.aborted ? (timedOut ? "timed_out" : "cancelled") : "failed" }),
      );
      return await Promise.race([completed, aborted]);
    } finally {
      clearTimeout(timer);
      if (this.operations.get(operationId) === controller) this.operations.delete(operationId);
    }
  }

  private describe(runtime: RuntimeLike, provider: RuntimeProvider, stored: Map<string, "api_key" | "oauth">, counts: Map<string, number>): ProviderItem {
    const status = runtime.getProviderAuthStatus(provider.id);
    const storedType = stored.get(provider.id);
    // An auth.json entry can be "configured" by Pi's own reckoning while still not
    // actually resolving (a `$VARIABLE` reference this GUI process cannot see).
    // hasConfiguredAuth() is the authoritative check; cross-referencing it against
    // the raw, unresolved credential is what lets us name the missing variable.
    const unresolved = status.source === "stored" && !runtime.hasConfiguredAuth(provider.id) ? this.unresolvedCredentialDiagnostic(provider) : undefined;
    const connected = !unresolved && (status.configured || storedType !== undefined);
    return {
      id: provider.id,
      name: provider.name,
      authMethods: [...(provider.auth.apiKey ? ["api_key" as const] : []), ...(provider.auth.oauth ? ["oauth" as const] : [])],
      status: connected ? "connected" : "disconnected",
      credentialSource: connected ? source(status.source, storedType) : "unavailable",
      availableModelCount: counts.get(provider.id) ?? 0,
      diagnostics: connected ? [] : [unresolved ?? diagnostic("authentication_required", "Connect this provider to make its models available.", "connect")],
    };
  }

  // GUI apps do not inherit the environment variables set up in a user's shell
  // profile, so a `pi auth login`-written `$VARIABLE` reference that works fine in
  // a terminal can silently stop working once Apple Pi launches it. Naming the
  // missing variable turns a confusing "disconnected" into an actionable fix.
  private unresolvedCredentialDiagnostic(provider: RuntimeProvider): ProviderDiagnostic | undefined {
    const raw = this.rawCredential(provider.id);
    if (!raw || raw.type !== "api_key" || !raw.key || isCommandReference(raw.key)) return undefined;
    const missing = unresolvedEnvironmentVariableNames(raw.key);
    if (missing.length === 0) return undefined;
    return diagnostic(
      "credential_unresolved",
      `The Pi CLI credential for ${provider.name} reads ${missing.join(", ")}, which is not set in Apple Pi. Launch Apple Pi from a terminal to inherit shell variables, or connect a key here instead.`,
      "check_environment",
    );
  }
}

function source(runtimeSource: RuntimeAuthSource | string | undefined, storedType: "api_key" | "oauth" | undefined): CredentialSource {
  // Apple Pi's own runtime-injected key always takes precedence: a real ModelRuntime
  // types it identically to a genuine auth.json entry in listCredentials() ("api_key"),
  // so `storedType` alone cannot tell them apart once both exist for the same provider.
  if (runtimeSource === "runtime") return "apple_pi";
  if (storedType === "oauth") return "oauth";
  if (storedType === "api_key" || runtimeSource === "stored") return "shared_pi_profile";
  if (runtimeSource === "models_json_command") return "command";
  // A literal key written directly into models.json (or, unreachable for Apple Pi
  // today, an SDK-registered extension key) is still a CLI-managed literal secret.
  if (runtimeSource === "models_json_key" || runtimeSource === "fallback") return "shared_pi_profile";
  if (runtimeSource === "environment") return "environment";
  return "unavailable";
}

const ENV_VAR_REFERENCE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;

function isCommandReference(rawKey: string): boolean {
  return rawKey.startsWith("!");
}

// A minimal reimplementation of Pi's own `$VAR`/`${VAR}` template scan
// (`getConfigValueEnvVarNames` in `resolve-config-value.ts`), which is an internal,
// unexported helper. Good enough to name the common case without executing anything.
function unresolvedEnvironmentVariableNames(rawKey: string): string[] {
  const names = new Set<string>();
  for (const match of rawKey.matchAll(ENV_VAR_REFERENCE)) {
    const name = match[1];
    if (name && process.env[name] === undefined) names.add(name);
  }
  return [...names];
}

function diagnostic(code: ProviderDiagnostic["code"], message: string, action?: ProviderDiagnostic["action"]): ProviderDiagnostic {
  return { code, severity: code === "authentication_required" ? "warning" : "error", message, ...(action ? { action } : {}) };
}

function providerNotFound(): ProviderOperationResult {
  return { diagnostics: [diagnostic("provider_not_found", "The requested provider is not available.", "retry")] };
}

function operationDiagnostics(outcome: OperationOutcome<unknown>, failureCode: ProviderDiagnostic["code"], failureMessage: string): ProviderDiagnostic[] {
  if (outcome.state === "completed") return [];
  if (outcome.state === "cancelled") return [diagnostic("operation_cancelled", "The operation was cancelled.", "retry")];
  if (outcome.state === "timed_out") return [diagnostic("operation_timed_out", "The operation exceeded its time limit.", "retry")];
  return [diagnostic(failureCode, failureMessage, "retry")];
}
