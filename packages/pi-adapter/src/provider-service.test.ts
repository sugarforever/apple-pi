import { describe, expect, it, vi } from "vitest";
import type { CustomProviderDefinition } from "@apple-pi/protocol";
import type { CustomProviderRepository } from "./custom-provider-store.js";
import { PiProviderService } from "./provider-service.js";

const customDefinition: CustomProviderDefinition = {
  id: "my-local-llm",
  name: "My Local LLM",
  baseUrl: "https://localhost:8080/v1",
  api: "openai-completions",
  models: [{ id: "local-model-a", name: "Local Model A" }],
};

function customProviderRepositoryDouble(initial: CustomProviderDefinition[] = []): CustomProviderRepository {
  const providers = new Map(initial.map((definition) => [definition.id, definition]));
  return {
    list: vi.fn(async () => [...providers.values()]),
    get: vi.fn(async (id: string) => providers.get(id)),
    upsert: vi.fn(async (definition: CustomProviderDefinition) => {
      providers.set(definition.id, definition);
    }),
    remove: vi.fn(async (id: string) => providers.delete(id)),
  };
}

// `stored` mirrors what a real ModelRuntime's `listCredentials()`/`getProviderAuthStatus()`
// report for an auth.json entry (the Pi CLI's shared profile): `type` is the credential
// kind and `resolved` is whether it actually resolves to a usable value (false for a
// `$VARIABLE` reference this process cannot see). A real runtime always types a
// provider's `listCredentials()` entry as "api_key" once Apple Pi injects a runtime
// override, even when an unrelated stored entry exists underneath it — `configured`
// (the runtime override) must win over `stored` in both places, matching that behavior.
function runtimeDouble() {
  const configured = new Set<string>();
  const stored = new Map<string, { type: "api_key" | "oauth"; resolved: boolean }>();
  return {
    getProviders: () => [
      { id: "openai", name: "OpenAI", auth: { apiKey: {}, oauth: {} } },
      { id: "anthropic", name: "Anthropic", auth: { apiKey: {} } },
    ],
    getProvider(providerId: string) {
      return this.getProviders().find((provider) => provider.id === providerId);
    },
    getAvailableSnapshot: () => (configured.has("openai") ? [{ provider: "openai", id: "gpt", name: "GPT" }] : []),
    getProviderAuthStatus: (providerId: string) => {
      if (configured.has(providerId)) return { configured: true, source: "runtime" };
      if (stored.has(providerId)) return { configured: true, source: "stored" };
      return { configured: false };
    },
    hasConfiguredAuth: (providerId: string) => configured.has(providerId) || (stored.get(providerId)?.resolved ?? false),
    listCredentials: vi.fn(async () => {
      const entries = new Map<string, { providerId: string; type: "api_key" | "oauth" }>();
      for (const [providerId, credential] of stored) entries.set(providerId, { providerId, type: credential.type });
      for (const providerId of configured) entries.set(providerId, { providerId, type: "api_key" });
      return [...entries.values()];
    }),
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
    // A real `ModelRuntime.login()` persists the credential itself; this double only
    // needs to drive the interaction (notify/prompt) the way the real openai-codex
    // OAuth flow does, then mark the provider connected the way a real runtime would
    // report it afterwards (see the compatibility test for the real, grounded shape).
    login: vi.fn(
      async (
        providerId: string,
        _type: "oauth",
        interaction: { signal?: AbortSignal; notify: (event: unknown) => void; prompt: (prompt: unknown) => Promise<string> },
      ) => {
        interaction.signal?.throwIfAborted();
        stored.set(providerId, { type: "oauth", resolved: true });
        return { type: "oauth" };
      },
    ),
    // Test-only helper: simulates an auth.json entry (the Pi CLI's shared profile).
    _storeCredential: (providerId: string, type: "api_key" | "oauth", resolved: boolean) => stored.set(providerId, { type, resolved }),
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

  it("prioritizes an Apple Pi runtime credential over a same-shaped stored entry", async () => {
    // A real ModelRuntime types both an Apple-Pi-injected runtime key and a genuine
    // auth.json entry as "api_key" in listCredentials(), so the two are indistinguishable
    // by type alone. Apple Pi's own credential must still win for display purposes.
    const runtime = runtimeDouble();
    runtime._storeCredential("openai", "api_key", true);
    await runtime.setRuntimeApiKey("openai", "apple-pi-secret");

    const service = new PiProviderService(async () => runtime);
    const providers = await service.list();

    expect(providers.find((provider) => provider.id === "openai")).toMatchObject({ credentialSource: "apple_pi", status: "connected" });
  });

  it("classifies a working auth.json credential as the shared Pi profile", async () => {
    const runtime = runtimeDouble();
    runtime._storeCredential("anthropic", "api_key", true);

    const service = new PiProviderService(async () => runtime);
    const providers = await service.list();

    expect(providers.find((provider) => provider.id === "anthropic")).toMatchObject({ credentialSource: "shared_pi_profile", status: "connected" });
  });

  it("explains when a shared credential's $VARIABLE reference cannot resolve in this process", async () => {
    const runtime = runtimeDouble();
    runtime._storeCredential("anthropic", "api_key", false);
    const rawCredential = vi.fn(() => ({ type: "api_key" as const, key: "$TOTALLY_UNSET_VAR_XYZ" }));

    const service = new PiProviderService(async () => runtime, fetch, rawCredential);
    const providers = await service.list();

    expect(rawCredential).toHaveBeenCalledWith("anthropic");
    expect(providers.find((provider) => provider.id === "anthropic")).toMatchObject({
      status: "disconnected",
      credentialSource: "unavailable",
      diagnostics: [{ code: "credential_unresolved", severity: "error", action: "check_environment" }],
    });
    const message = providers.find((provider) => provider.id === "anthropic")!.diagnostics[0]!.message;
    expect(message).toContain("TOTALLY_UNSET_VAR_XYZ");
    expect(message.length).toBeLessThanOrEqual(240);
  });

  it("does not flag a command-based shared credential as an unresolved variable", async () => {
    const runtime = runtimeDouble();
    // Command references resolve lazily at request time, so the SDK reports them as
    // configured up front without actually running the command.
    runtime._storeCredential("anthropic", "api_key", true);
    const rawCredential = vi.fn(() => ({ type: "api_key" as const, key: "!echo sk-from-command" }));

    const service = new PiProviderService(async () => runtime, fetch, rawCredential);
    const providers = await service.list();

    expect(providers.find((provider) => provider.id === "anthropic")).toMatchObject({ status: "connected", credentialSource: "shared_pi_profile" });
  });

  it("classifies a models.json shell-command credential as a command reference", async () => {
    const runtime = runtimeDouble();
    runtime.getProviderAuthStatus = (providerId: string) =>
      providerId === "anthropic" ? { configured: true, source: "models_json_command" } : { configured: false };
    runtime.hasConfiguredAuth = (providerId: string) => providerId === "anthropic";

    const service = new PiProviderService(async () => runtime);
    const providers = await service.list();

    expect(providers.find((provider) => provider.id === "anthropic")).toMatchObject({ status: "connected", credentialSource: "command" });
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

  describe("oauthLogin", () => {
    it("rejects an unknown provider and a provider without an oauth auth method", async () => {
      const service = new PiProviderService(async () => runtimeDouble());

      await expect(service.oauthLogin("missing", "oauth-missing", 1_000, () => undefined)).resolves.toEqual({
        diagnostics: [{ code: "provider_not_found", severity: "error", message: "The requested provider is not available.", action: "retry" }],
      });
      await expect(service.oauthLogin("anthropic", "oauth-no-oauth", 1_000, () => undefined)).resolves.toMatchObject({
        diagnostics: [{ code: "authentication_failed", action: "connect" }],
      });
    });

    it("relays notify() calls as provider auth events and reports the provider connected afterwards", async () => {
      const runtime = runtimeDouble();
      runtime.login.mockImplementation(async (providerId: string, _type: "oauth", interaction: { notify: (event: unknown) => void }) => {
        interaction.notify({ type: "auth_url", url: "https://auth.openai.com/oauth/authorize?state=abc", instructions: "A browser window should open." });
        interaction.notify({ type: "progress", message: "Waiting for authentication..." });
        (runtime as unknown as { _storeCredential: (id: string, type: "oauth", resolved: boolean) => void })._storeCredential(providerId, "oauth", true);
        return { type: "oauth" };
      });
      const service = new PiProviderService(async () => runtime);
      const events: unknown[] = [];

      const result = await service.oauthLogin("openai", "oauth-openai", 1_000, (event) => events.push(event));

      expect(events).toEqual([
        { type: "auth_url", url: "https://auth.openai.com/oauth/authorize?state=abc", instructions: "A browser window should open." },
        { type: "progress", message: "Waiting for authentication..." },
      ]);
      expect(result).toMatchObject({ provider: { status: "connected", credentialSource: "oauth" }, diagnostics: [] });
    });

    it("relays a select prompt with a generated promptId and forwards the answer to the runtime", async () => {
      const runtime = runtimeDouble();
      let capturedAnswer: string | undefined;
      runtime.login.mockImplementation(async (_providerId: string, _type: "oauth", interaction: { prompt: (prompt: unknown) => Promise<string> }) => {
        capturedAnswer = await interaction.prompt({ type: "select", message: "Select login method", options: [{ id: "browser", label: "Browser login" }] });
        return { type: "oauth" };
      });
      const service = new PiProviderService(
        async () => runtime,
        fetch,
        undefined,
        () => "prompt-fixed-id",
      );
      const events: unknown[] = [];

      const login = service.oauthLogin("openai", "oauth-select", 5_000, (event) => events.push(event));
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toEqual({
        type: "prompt",
        prompt: { type: "select", promptId: "prompt-fixed-id", message: "Select login method", options: [{ id: "browser", label: "Browser login" }] },
      });

      expect(service.respondOAuthPrompt("oauth-select", "prompt-fixed-id", "browser")).toBe(true);
      await login;
      expect(capturedAnswer).toBe("browser");
    });

    it("ignores a prompt response for a stale or unknown promptId", async () => {
      const service = new PiProviderService(async () => runtimeDouble());
      expect(service.respondOAuthPrompt("no-such-operation", "no-such-prompt", "value")).toBe(false);
    });

    it("rejects a pending prompt and reports cancellation when the operation is cancelled mid-login", async () => {
      const runtime = runtimeDouble();
      runtime.login.mockImplementation(async (_providerId: string, _type: "oauth", interaction: { prompt: (prompt: unknown) => Promise<string> }) => {
        await interaction.prompt({ type: "manual_code", message: "Paste the authorization code" });
        return { type: "oauth" };
      });
      const service = new PiProviderService(async () => runtime);
      const events: unknown[] = [];

      const login = service.oauthLogin("openai", "oauth-cancel", 5_000, (event) => events.push(event));
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(service.cancel("oauth-cancel")).toBe(true);

      const result = await login;
      expect(result.diagnostics).toMatchObject([{ code: "operation_cancelled" }]);
      // Cancelling did not leave the prompt answerable afterwards.
      expect(service.respondOAuthPrompt("oauth-cancel", "prompt-fixed-id", "anything")).toBe(false);
    });

    it("never lets an oauth login event or diagnostic carry a bearer token", async () => {
      const runtime = runtimeDouble();
      runtime.login.mockImplementation(async (providerId: string, _type: "oauth", interaction: { notify: (event: unknown) => void }) => {
        interaction.notify({ type: "auth_url", url: "https://auth.openai.com/oauth/authorize?state=abc" });
        (runtime as unknown as { _storeCredential: (id: string, type: "oauth", resolved: boolean) => void })._storeCredential(providerId, "oauth", true);
        return { type: "oauth", access: "sk-never-return-this-access-token", refresh: "sk-never-return-this-refresh-token" };
      });
      const service = new PiProviderService(async () => runtime);
      const events: unknown[] = [];

      const result = await service.oauthLogin("openai", "oauth-secret", 1_000, (event) => events.push(event));

      expect(JSON.stringify(events)).not.toContain("sk-never-return-this");
      expect(JSON.stringify(result)).not.toContain("sk-never-return-this");
    });
  });

  describe("custom providers", () => {
    it("lists what the store manages", async () => {
      const store = customProviderRepositoryDouble([customDefinition]);
      const service = new PiProviderService(
        async () => runtimeDouble(),
        fetch,
        undefined,
        undefined,
        () => store,
      );

      await expect(service.listCustomProviders()).resolves.toEqual([customDefinition]);
    });

    it("rejects a duplicate provider id without persisting it or touching the runtime", async () => {
      const runtime = runtimeDouble();
      const store = customProviderRepositoryDouble();
      const service = new PiProviderService(
        async () => runtime,
        fetch,
        undefined,
        undefined,
        () => store,
      );

      const result = await service.addCustomProvider({ ...customDefinition, id: "openai" }, "add-dup", 1_000);

      expect(result.diagnostics).toMatchObject([{ code: "invalid_provider_config", severity: "error" }]);
      expect(store.upsert).not.toHaveBeenCalled();
      expect(runtime.refresh).not.toHaveBeenCalled();
    });

    it("rejects an invalid base URL before persisting anything", async () => {
      const store = customProviderRepositoryDouble();
      const service = new PiProviderService(
        async () => runtimeDouble(),
        fetch,
        undefined,
        undefined,
        () => store,
      );

      const result = await service.addCustomProvider({ ...customDefinition, baseUrl: "not-a-url" }, "add-bad-url", 1_000);

      expect(result.diagnostics).toMatchObject([{ code: "invalid_provider_config" }]);
      expect(store.upsert).not.toHaveBeenCalled();
    });

    it("persists a valid definition and refreshes only that provider", async () => {
      const runtime = runtimeDouble();
      const store = customProviderRepositoryDouble();
      const service = new PiProviderService(
        async () => runtime,
        fetch,
        undefined,
        undefined,
        () => store,
      );

      const result = await service.addCustomProvider(customDefinition, "add-ok", 1_000);

      expect(store.upsert).toHaveBeenCalledWith(customDefinition);
      expect(runtime.refresh).toHaveBeenCalledWith(expect.objectContaining({ allowNetwork: false, force: true, providers: ["my-local-llm"] }));
      expect(result.diagnostics).toEqual([]);
    });

    it("rejects renaming a provider id through update", async () => {
      const store = customProviderRepositoryDouble([customDefinition]);
      const service = new PiProviderService(
        async () => runtimeDouble(),
        fetch,
        undefined,
        undefined,
        () => store,
      );

      const result = await service.updateCustomProvider("my-local-llm", { ...customDefinition, id: "renamed" }, "update-rename", 1_000);

      expect(result.diagnostics).toMatchObject([{ code: "invalid_provider_config" }]);
      expect(store.upsert).not.toHaveBeenCalled();
    });

    it("reports provider_not_found when updating a definition Apple Pi does not manage", async () => {
      const store = customProviderRepositoryDouble();
      const service = new PiProviderService(
        async () => runtimeDouble(),
        fetch,
        undefined,
        undefined,
        () => store,
      );

      const result = await service.updateCustomProvider("my-local-llm", customDefinition, "update-missing", 1_000);

      expect(result.diagnostics).toMatchObject([{ code: "provider_not_found" }]);
    });

    it("updates an existing definition and refreshes only that provider", async () => {
      const runtime = runtimeDouble();
      const store = customProviderRepositoryDouble([customDefinition]);
      const service = new PiProviderService(
        async () => runtime,
        fetch,
        undefined,
        undefined,
        () => store,
      );
      const updated = { ...customDefinition, name: "Renamed" };

      const result = await service.updateCustomProvider("my-local-llm", updated, "update-ok", 1_000);

      expect(store.upsert).toHaveBeenCalledWith(updated);
      expect(runtime.refresh).toHaveBeenCalledWith(expect.objectContaining({ providers: ["my-local-llm"] }));
      expect(result.diagnostics).toEqual([]);
    });

    it("removes a managed provider and triggers a full catalog refresh", async () => {
      const runtime = runtimeDouble();
      const store = customProviderRepositoryDouble([customDefinition]);
      const service = new PiProviderService(
        async () => runtime,
        fetch,
        undefined,
        undefined,
        () => store,
      );

      const result = await service.removeCustomProvider("my-local-llm", "remove-ok", 1_000);

      expect(store.remove).toHaveBeenCalledWith("my-local-llm");
      expect(runtime.refresh).toHaveBeenCalledWith(expect.objectContaining({ allowNetwork: false, force: true }));
      expect(result.diagnostics).toEqual([]);
      expect(result.provider).toBeUndefined();
    });

    it("reports provider_not_found when removing a definition Apple Pi does not manage", async () => {
      const runtime = runtimeDouble();
      const store = customProviderRepositoryDouble();
      const service = new PiProviderService(
        async () => runtime,
        fetch,
        undefined,
        undefined,
        () => store,
      );

      const result = await service.removeCustomProvider("unknown", "remove-missing", 1_000);

      expect(result.diagnostics).toMatchObject([{ code: "provider_not_found" }]);
      expect(runtime.refresh).not.toHaveBeenCalled();
    });
  });
});
