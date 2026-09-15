import { describe, expect, it, vi } from "vitest";
import { PiProviderService } from "./provider-service.js";

function runtimeDouble() {
  const configured = new Set<string>();
  return {
    getProviders: () => [
      { id: "openai", name: "OpenAI", auth: { apiKey: {}, oauth: {} } },
      { id: "anthropic", name: "Anthropic", auth: { apiKey: {} } },
    ],
    getProvider(providerId: string) {
      return this.getProviders().find((provider) => provider.id === providerId);
    },
    getAvailableSnapshot: () => (configured.has("openai") ? [{ provider: "openai", id: "gpt", name: "GPT" }] : []),
    getProviderAuthStatus: (providerId: string) => ({ configured: configured.has(providerId), ...(configured.has(providerId) ? { source: "runtime" } : {}) }),
    listCredentials: vi.fn(async () => []),
    checkAuth: vi.fn(async (providerId: string, _options?: { signal?: AbortSignal }) =>
      configured.has(providerId) ? { source: "runtime", type: "api_key" as const } : undefined,
    ),
    getAuth: vi.fn(async (providerId: string) => (configured.has(providerId) ? { auth: { apiKey: "runtime-secret" } } : undefined)),
    setRuntimeApiKey: vi.fn(async (providerId: string, _apiKey: string, options?: { signal?: AbortSignal }) => {
      options?.signal?.throwIfAborted();
      configured.add(providerId);
    }),
    removeRuntimeApiKey: vi.fn(async (providerId: string) => {
      configured.delete(providerId);
    }),
    logout: vi.fn(async (providerId: string) => {
      configured.delete(providerId);
    }),
    refresh: vi.fn(async (_options?: { signal?: AbortSignal }) => ({ aborted: false, errors: new Map<string, Error>() })),
  };
}

describe("PiProviderService", () => {
  it("enumerates connected and disconnected providers without credential values", async () => {
    const runtime = runtimeDouble();
    const service = new PiProviderService(async () => runtime);
    await service.connectApiKey("openai", "sk-never-return-this", "connect", 1_000);

    const providers = await service.list();

    expect(providers).toMatchObject([
      { id: "anthropic", status: "disconnected", credentialSource: "unavailable", availableModelCount: 0 },
      { id: "openai", status: "connected", credentialSource: "apple_pi", availableModelCount: 1 },
    ]);
    expect(JSON.stringify(providers)).not.toContain("sk-never-return-this");
  });

  it("returns actionable diagnostics for missing providers and credentials", async () => {
    const service = new PiProviderService(async () => runtimeDouble());
    await expect(service.verify("missing", "verify-missing", 1_000)).resolves.toEqual({
      diagnostics: [{ code: "provider_not_found", severity: "error", message: "The requested provider is not available.", action: "retry" }],
    });
    await expect(service.verify("openai", "verify-openai", 1_000)).resolves.toMatchObject({
      diagnostics: [{ code: "authentication_required", action: "connect" }],
    });
  });

  it("disconnects Apple Pi credentials but directs ambient credentials to their source", async () => {
    const runtime = runtimeDouble();
    const service = new PiProviderService(async () => runtime);
    await service.connectApiKey("openai", "secret", "connect", 1_000);

    await expect(service.disconnect("openai", "disconnect", 1_000)).resolves.toMatchObject({ provider: { status: "disconnected" }, diagnostics: [] });
    expect(runtime.removeRuntimeApiKey).toHaveBeenCalledWith("openai", expect.objectContaining({ signal: expect.any(AbortSignal) }));

    runtime.getProviderAuthStatus = () => ({ configured: true, source: "environment" });
    await expect(service.disconnect("anthropic", "ambient", 1_000)).resolves.toMatchObject({
      diagnostics: [{ code: "authentication_failed", action: "check_environment" }],
    });
  });

  it("cancels an in-flight authentication operation without exposing its failure", async () => {
    const runtime = runtimeDouble();
    runtime.checkAuth.mockImplementation(
      (_providerId: string, options?: { signal?: AbortSignal }) =>
        new Promise<{ source: string; type: "api_key" } | undefined>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("sk-secret provider failure")), { once: true });
        }),
    );
    const service = new PiProviderService(async () => runtime);

    const verifying = service.verify("openai", "verify", 1_000);
    await vi.waitFor(() => expect(runtime.checkAuth).toHaveBeenCalledOnce());
    expect(service.cancel("verify")).toBe(true);

    const result = await verifying;
    expect(result.diagnostics).toMatchObject([{ code: "operation_cancelled" }]);
    expect(JSON.stringify(result)).not.toContain("sk-secret");
  });

  it("bounds model refresh and sanitizes provider errors", async () => {
    const runtime = runtimeDouble();
    runtime.refresh.mockImplementation((_options?: { signal?: AbortSignal }) => new Promise<{ aborted: boolean; errors: Map<string, Error> }>(() => {}));
    const service = new PiProviderService(async () => runtime);

    const result = await service.refresh(undefined, "refresh", 100);

    expect(result.diagnostics).toMatchObject([{ code: "operation_timed_out" }]);
  });

  it("retains the last-known catalog when a refresh times out instead of wiping it", async () => {
    const runtime = runtimeDouble();
    const service = new PiProviderService(async () => runtime);
    await service.connectApiKey("openai", "secret", "connect", 1_000);

    runtime.refresh.mockImplementation(() => new Promise<{ aborted: boolean; errors: Map<string, Error> }>(() => {}));
    const result = await service.refresh(undefined, "refresh-timeout", 50);

    expect(result.diagnostics).toMatchObject([{ code: "operation_timed_out" }]);
    expect(result.models).toEqual([{ provider: "openai", modelId: "gpt", name: "GPT" }]);
    expect(result.providers.find((provider) => provider.id === "openai")).toMatchObject({ status: "connected" });
  });

  it("retains the last-known catalog when a refresh is cancelled", async () => {
    const runtime = runtimeDouble();
    const service = new PiProviderService(async () => runtime);
    await service.connectApiKey("openai", "secret", "connect", 1_000);

    runtime.refresh.mockImplementation(
      (options?: { signal?: AbortSignal }) =>
        new Promise<{ aborted: boolean; errors: Map<string, Error> }>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("refresh aborted")), { once: true });
        }),
    );
    const refreshing = service.refresh(undefined, "refresh-cancel", 5_000);
    await vi.waitFor(() => expect(runtime.refresh).toHaveBeenCalledOnce());
    expect(service.cancel("refresh-cancel")).toBe(true);

    const result = await refreshing;
    expect(result.diagnostics).toMatchObject([{ code: "operation_cancelled" }]);
    expect(result.models).toEqual([{ provider: "openai", modelId: "gpt", name: "GPT" }]);
  });

  it("coalesces concurrent refresh calls into a single underlying runtime refresh", async () => {
    const runtime = runtimeDouble();
    let resolveRefresh!: (value: { aborted: boolean; errors: Map<string, Error> }) => void;
    runtime.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const service = new PiProviderService(async () => runtime);

    const first = service.refresh(undefined, "refresh-a", 5_000);
    const second = service.refresh(undefined, "refresh-b", 5_000);
    await vi.waitFor(() => expect(runtime.refresh).toHaveBeenCalledTimes(1));
    resolveRefresh({ aborted: false, errors: new Map() });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(runtime.refresh).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
  });

  it("verifies DeepSeek remotely and rolls back a rejected key", async () => {
    const runtime = runtimeDouble();
    runtime.getProviders = () => [{ id: "deepseek", name: "DeepSeek", auth: { apiKey: {} } }];
    const request = vi.fn(async () => new Response("unauthorized sk-secret", { status: 401 }));
    const service = new PiProviderService(async () => runtime, request);

    const result = await service.connectApiKey("deepseek", "sk-rejected", "connect-deepseek", 1_000);

    expect(result).toMatchObject({ diagnostics: [{ code: "authentication_failed", action: "reconnect" }] });
    expect(runtime.removeRuntimeApiKey).toHaveBeenCalledWith("deepseek", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(JSON.stringify(result)).not.toContain("sk-rejected");
  });

  it("accepts a verified DeepSeek key without sending model traffic", async () => {
    const runtime = runtimeDouble();
    runtime.getProviders = () => [{ id: "deepseek", name: "DeepSeek", auth: { apiKey: {} } }];
    const request = vi.fn(async () => new Response('{"is_available":true}', { status: 200 }));
    const service = new PiProviderService(async () => runtime, request);

    await expect(service.connectApiKey("deepseek", "sk-valid", "connect-deepseek", 1_000)).resolves.toMatchObject({ diagnostics: [] });
    expect(request).toHaveBeenCalledWith("https://api.deepseek.com/user/balance", expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }));
  });
});
