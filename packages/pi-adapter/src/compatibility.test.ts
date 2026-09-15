import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createAgentSession, ModelRuntime, readStoredCredential, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { CustomProviderStore, PI_VERSION, mapPiEvent, mapPiMessages, mapPiModel, mapPiSessionItem, PiProviderService } from "./index.js";

const fixtureUrl = (name: string) => new URL(`../test/fixtures/pi-0.84.2/${name}`, import.meta.url);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "apple-pi-compatibility-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Pi 0.84.2 mapper compatibility", () => {
  it("replays the sanitized Pi boundary corpus", async () => {
    const piPackageUrl = new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent"));
    const piPackage = JSON.parse(await readFile(piPackageUrl, "utf8")) as { version: string };
    const manifest = JSON.parse(await readFile(fixtureUrl("manifest.json"), "utf8")) as {
      piVersion: string;
      sanitized: boolean;
    };
    const fixtures = JSON.parse(await readFile(fixtureUrl("mapper-cases.json"), "utf8")) as {
      messages: { input: unknown; expected: unknown };
      events: Array<{ name: string; input: unknown; expected: unknown }>;
      models: Array<{ input: unknown; expected: unknown }>;
      sessions: Array<{ input: unknown; expected: unknown }>;
    };

    expect(manifest).toMatchObject({ piVersion: PI_VERSION, sanitized: true });
    expect(piPackage.version).toBe(manifest.piVersion);
    expect(mapPiMessages(fixtures.messages.input)).toEqual(fixtures.messages.expected);
    for (const fixture of fixtures.events) expect(mapPiEvent(fixture.input), fixture.name).toEqual(fixture.expected);
    for (const fixture of fixtures.models) expect(mapPiModel(fixture.input)).toEqual(fixture.expected);
    for (const fixture of fixtures.sessions) expect(mapPiSessionItem(fixture.input)).toEqual(fixture.expected);
  });
});

describe("Pi 0.84.2 public SDK compatibility", () => {
  it("creates, opens, and lists persisted sessions through the public SessionManager API", async () => {
    const root = await temporaryDirectory();
    const cwd = join(root, "workspace");
    const sessionDirectory = join(root, "sessions");
    const created = SessionManager.create(cwd, sessionDirectory, { id: "00000000-0000-4000-8000-000000000842" });
    created.appendMessage({ role: "user", content: "Synthetic SDK request", timestamp: 1000 });
    created.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Synthetic SDK response" }],
      api: "openai-completions",
      provider: "fixture-provider",
      model: "fixture-model-a",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 2000,
    });
    created.appendModelChange("fixture-provider", "fixture-model-b");

    const sessionFile = created.getSessionFile();
    expect(sessionFile).toEqual(expect.any(String));
    const opened = SessionManager.open(sessionFile!, sessionDirectory, cwd);
    const listed = await SessionManager.list(cwd, sessionDirectory);

    expect(opened.getSessionId()).toBe(created.getSessionId());
    expect(opened.getSessionId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(opened.buildSessionContext()).toMatchObject({
      messages: [
        { role: "user", content: "Synthetic SDK request", timestamp: 1000 },
        { role: "assistant", content: [{ type: "text", text: "Synthetic SDK response" }] },
      ],
      model: { provider: "fixture-provider", modelId: "fixture-model-b" },
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: opened.getSessionId(), path: sessionFile, messageCount: 2 });
  });

  it("keeps the AgentSession cancellation and model-switching surface compatible", async () => {
    type Options = NonNullable<Parameters<typeof createAgentSession>[0]>;
    const root = await temporaryDirectory();
    const runtime = await ModelRuntime.create({
      authPath: join(root, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(root, "models-cache.json"),
      refreshOnCreate: false,
    });
    runtime.registerProvider("fixture-provider", {
      api: "openai-completions",
      baseUrl: "https://invalid.example",
      apiKey: "fixture-token",
      models: [
        {
          id: "fixture-model-b",
          name: "Fixture Model B",
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 4096,
          maxTokens: 512,
        },
      ],
    });
    const model = {
      id: "fixture-model-a",
      name: "Fixture Model A",
      api: "openai-completions",
      provider: "fixture-provider",
      baseUrl: "https://invalid.example",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 512,
    } as const satisfies NonNullable<Options["model"]>;
    const { session } = await createAgentSession({
      cwd: root,
      agentDir: join(root, "agent"),
      sessionManager: SessionManager.inMemory(root),
      modelRuntime: runtime,
      model,
      noTools: "all",
    });

    expectTypeOf(session.subscribe).toBeFunction();
    expectTypeOf(session.abort).toBeFunction();
    expectTypeOf(session.setModel).toBeFunction();
    const unsubscribe = session.subscribe(() => undefined);
    await session.abort();
    await session.setModel({ ...model, id: "fixture-model-b", name: "Fixture Model B" });

    expect(session.model?.id).toBe("fixture-model-b");
    unsubscribe();
    session.dispose();
  });

  it("restores the legacy JSONL identity, projected messages, model, and active path", async () => {
    const root = await temporaryDirectory();
    const restoredPath = join(root, basename(fixtureUrl("legacy-session-v3.jsonl").pathname));
    await copyFile(fixtureUrl("legacy-session-v3.jsonl"), restoredPath);

    const restored = SessionManager.open(restoredPath, root, join(root, "workspace"));
    const context = restored.buildSessionContext();

    expect(restored.getSessionId()).toBe("00000000-0000-4000-8000-000000000084");
    expect(restored.getLeafId()).toBe("e5f6a7b8");
    expect(restored.getBranch().map((entry) => entry.id)).toEqual(["a1b2c3d4", "b2c3d4e5", "d4e5f6a7", "e5f6a7b8"]);
    expect(context.model).toEqual({ provider: "fixture-provider", modelId: "fixture-model-b" });
    expect(mapPiMessages(context.messages)).toEqual([
      { role: "user", content: [{ type: "text", text: "Synthetic legacy request" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", text: "Synthetic legacy thought" },
          { type: "tool_call", id: "call-legacy-1", name: "fixture_tool", arguments: { target: "sample.txt" } },
          { type: "text", text: "Synthetic legacy response" },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool_result",
            toolCallId: "call-legacy-1",
            name: "fixture_tool",
            output: [{ type: "text", text: "Synthetic legacy output" }],
            isError: false,
          },
        ],
      },
    ]);
  });
});

// Grounds the credential-reuse behavior (issue #29) against the real SDK rather than
// a hand-written double: `ModelRuntime.getProviderAuthStatus()` reports an auth.json
// entry as "configured" purely because it exists, even when its `$VARIABLE` cannot
// resolve in this process, and `readStoredCredential()` is the only public, side-effect-
// free way to see the raw value behind that status.
describe("Pi 0.84.2 shared-profile credential reuse compatibility", () => {
  it("names the unresolved environment variable behind a Pi CLI auth.json entry instead of reporting a generic disconnect", async () => {
    const root = await temporaryDirectory();
    const authPath = join(root, "auth.json");
    await writeFile(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "$APPLE_PI_TEST_UNSET_VAR" } }));
    delete process.env.APPLE_PI_TEST_UNSET_VAR;
    const runtime = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: true });
    // A real caller only relies on PiProviderService's default reader when it also lets
    // ModelRuntime pick its own default auth.json (see PiSessionService). This fixture
    // uses a temp authPath instead, so it points the reader at the same file explicitly.
    const service = new PiProviderService(
      async () => runtime,
      fetch,
      (providerId) => readStoredCredential(providerId, authPath),
    );

    const providers = await service.list();
    const anthropic = providers.find((provider) => provider.id === "anthropic");

    expect(anthropic).toMatchObject({ status: "disconnected", credentialSource: "unavailable" });
    expect(anthropic?.diagnostics).toMatchObject([{ code: "credential_unresolved", action: "check_environment" }]);
    expect(anthropic?.diagnostics[0]?.message).toContain("APPLE_PI_TEST_UNSET_VAR");
  });

  it("reuses a Pi CLI credential once its environment variable is inherited, without editing auth.json", async () => {
    const root = await temporaryDirectory();
    const authPath = join(root, "auth.json");
    await writeFile(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "$APPLE_PI_TEST_SET_VAR" } }));
    process.env.APPLE_PI_TEST_SET_VAR = "sk-from-shell-profile";
    try {
      const runtime = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: true });
      const service = new PiProviderService(async () => runtime);

      const providers = await service.list();

      expect(providers.find((provider) => provider.id === "anthropic")).toMatchObject({ status: "connected", credentialSource: "shared_pi_profile" });
    } finally {
      delete process.env.APPLE_PI_TEST_SET_VAR;
    }
    expect(JSON.parse(await readFile(authPath, "utf8"))).toEqual({ anthropic: { type: "api_key", key: "$APPLE_PI_TEST_SET_VAR" } });
  });

  it("reflects a CLI login made after startup once explicitly refreshed, without corrupting auth.json", async () => {
    const root = await temporaryDirectory();
    const authPath = join(root, "auth.json");
    await writeFile(authPath, "{}");
    const runtime = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: true });
    const service = new PiProviderService(async () => runtime);
    expect((await service.list()).find((provider) => provider.id === "anthropic")).toMatchObject({ status: "disconnected" });

    // Simulates `pi auth login` running in a terminal while Apple Pi stays open.
    await writeFile(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "sk-from-cli-login" } }));
    const refreshed = await service.refresh(undefined, "reload-after-cli-login", 5_000);

    expect(refreshed.providers.find((provider) => provider.id === "anthropic")).toMatchObject({ status: "connected", credentialSource: "shared_pi_profile" });
    expect(JSON.parse(await readFile(authPath, "utf8"))).toEqual({ anthropic: { type: "api_key", key: "sk-from-cli-login" } });
  });
});

// Grounds issue #28 (OAuth sign-in) against the real SDK. `ModelRuntime.login()`
// persists the resulting credential itself, into the very auth.json a `pi auth
// login` run from a terminal would write to (see `Models.login()` in
// `@earendil-works/pi-ai`'s `models.ts`, which calls `this.credentials.modify()`
// unconditionally) — there is no separate, Apple-Pi-owned OAuth credential store
// in this SDK version, and no runtime-only OAuth overlay analogous to
// `setRuntimeApiKey()`. So an Apple-Pi-initiated openai-codex sign-in and a CLI
// `pi auth login` are, once complete, byte-for-byte the same auth.json entry.
describe("Pi 0.84.2 OAuth sign-in compatibility (issue #28)", () => {
  it("recognizes an existing CLI-created openai-codex OAuth credential as connected, without any Apple Pi involvement", async () => {
    const root = await temporaryDirectory();
    const authPath = join(root, "auth.json");
    const fakeAccessToken = [
      Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
      Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_123" } })).toString("base64url"),
      "sig",
    ].join(".");
    await writeFile(
      authPath,
      JSON.stringify({
        "openai-codex": { type: "oauth", access: fakeAccessToken, refresh: "refresh-token-xyz", expires: Date.now() + 3_600_000, accountId: "acct_123" },
      }),
    );

    const runtime = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: true });
    const service = new PiProviderService(async () => runtime);

    const providers = await service.list();
    const codex = providers.find((provider) => provider.id === "openai-codex");

    expect(codex).toMatchObject({ status: "connected", credentialSource: "oauth", authMethods: ["oauth"] });
    expect(codex?.availableModelCount).toBeGreaterThan(0);
    expect(codex?.diagnostics).toEqual([]);
  });

  it("cancelling an in-flight openai-codex sign-in returns to a safe, retryable state without any network call completing", async () => {
    const root = await temporaryDirectory();
    const authPath = join(root, "auth.json");
    const runtime = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: true });
    const service = new PiProviderService(async () => runtime);
    const events: unknown[] = [];

    const login = service.oauthLogin("openai-codex", "oauth-cancel-real", 30_000, (event) => events.push(event));
    // `openaiCodexOAuth.login()` (see the real SDK's `auth/oauth/openai-codex.ts`)
    // first prompts a "select" (browser vs. device-code login) before any network
    // call, so receiving that prompt event is confirmation the real login flow
    // actually started before we cancel it.
    await vi.waitFor(() => expect(events).toEqual([{ type: "prompt", prompt: expect.objectContaining({ type: "select" }) }]), { timeout: 5_000 });

    expect(service.cancel("oauth-cancel-real")).toBe(true);
    const result = await login;

    expect(result.diagnostics).toMatchObject([{ code: "operation_cancelled" }]);
    // Cancelling before the interaction resolved a credential means
    // `Models.login()` never reached its `credentials.modify()` persistence step:
    // auth.json stays exactly as `ModelRuntime.create()` initialized it, with no
    // openai-codex entry.
    expect(JSON.parse(await readFile(authPath, "utf8"))).toEqual({});
  });
});

// Grounds issue #27 (custom OpenAI-compatible providers) against the real SDK. A
// throwaway repro script against the installed @earendil-works/pi-coding-agent@0.84.2
// established three load-bearing facts this suite locks in: (1) a models.json-only
// provider with no "apiKey"/"oauth" field still
// gets a fabricated `auth.apiKey` login method from `composeApiKeyAuth()`, so the
// existing `provider.connectApiKey`/`verify`/`disconnect` commands work against a
// custom provider completely unmodified; (2) `ModelRuntime.refresh()` re-reads
// models.json from disk on every call, so writing a new/edited/removed provider and
// calling refresh (the same "refresh, don't recreate" path #26/#29 already use for
// auth.json) is picked up without recreating the runtime; (3) a provider entry that
// fails Pi's structural validation (e.g. missing baseUrl and models) only drops that
// one provider — but a genuine JSON-schema violation (e.g. a non-string "api") wipes
// out every models.json-configured provider, which is exactly why
// `CustomProviderStore`/`validateCustomProviderDefinition` validate strictly before
// ever writing to disk.
describe("Pi 0.84.2 custom OpenAI-compatible provider compatibility (issue #27)", () => {
  it("registers a custom provider through models.json, connects an API key through the existing runtime auth path, and removal makes it disappear from the live catalog", async () => {
    const root = await temporaryDirectory();
    const authPath = join(root, "auth.json");
    const modelsPath = join(root, "models.json");
    const store = new CustomProviderStore(join(root, "apple-pi-custom-providers.json"), modelsPath);
    const runtime = await ModelRuntime.create({ authPath, modelsPath, allowModelNetwork: false, refreshOnCreate: true });
    const service = new PiProviderService(
      async () => runtime,
      fetch,
      undefined,
      undefined,
      () => store,
    );

    const definition = {
      id: "my-local-llm",
      name: "My Local LLM",
      baseUrl: "https://localhost:8080/v1",
      api: "openai-completions" as const,
      models: [{ id: "local-model-a", name: "Local Model A", contextWindow: 8192, maxTokens: 2048 }],
    };

    const added = await service.addCustomProvider(definition, "add-1", 5_000);
    expect(added.diagnostics).toEqual([]);
    expect(added.provider).toMatchObject({ id: "my-local-llm", name: "My Local LLM", status: "disconnected", authMethods: ["api_key"] });

    // The provider's models.json entry never carries a secret.
    const rawModelsJson = await readFile(modelsPath, "utf8");
    expect(rawModelsJson).not.toContain("apiKey");

    // The existing, unmodified `connectApiKey` path already works against it because
    // `composeApiKeyAuth()` always fabricates an api_key auth method for a provider
    // with no oauth configured, even when models.json sets no "apiKey" field.
    const connected = await service.connectApiKey("my-local-llm", "sk-local-secret", "connect-1", 5_000);
    expect(connected.diagnostics).toEqual([]);
    expect(connected.provider).toMatchObject({ id: "my-local-llm", status: "connected", credentialSource: "apple_pi" });
    expect(JSON.stringify(connected)).not.toContain("sk-local-secret");

    const models = (await service.refresh(undefined, "refresh-1", 5_000)).models;
    expect(models).toContainEqual({ provider: "my-local-llm", modelId: "local-model-a", name: "Local Model A" });

    const removed = await service.removeCustomProvider("my-local-llm", "remove-1", 5_000);
    expect(removed.diagnostics).toEqual([]);
    expect(removed.provider).toBeUndefined();
    expect((await service.list()).some((provider) => provider.id === "my-local-llm")).toBe(false);
    expect(JSON.parse(await readFile(modelsPath, "utf8")).providers["my-local-llm"]).toBeUndefined();
  });

  it("keeps a pre-existing hand-written provider entry intact when adding and removing an unrelated custom provider", async () => {
    const root = await temporaryDirectory();
    const authPath = join(root, "auth.json");
    const modelsPath = join(root, "models.json");
    await writeFile(
      modelsPath,
      JSON.stringify({ providers: { "hand-written": { baseUrl: "https://hand-written.invalid/v1", api: "openai-completions", models: [{ id: "m1" }] } } }),
    );
    const store = new CustomProviderStore(join(root, "apple-pi-custom-providers.json"), modelsPath);
    const runtime = await ModelRuntime.create({ authPath, modelsPath, allowModelNetwork: false, refreshOnCreate: true });
    const service = new PiProviderService(
      async () => runtime,
      fetch,
      undefined,
      undefined,
      () => store,
    );

    await service.addCustomProvider(
      { id: "apple-pi-added", name: "Apple Pi Added", baseUrl: "https://apple-pi-added.invalid/v1", api: "openai-completions", models: [{ id: "m1" }] },
      "add-1",
      5_000,
    );
    await service.removeCustomProvider("apple-pi-added", "remove-1", 5_000);

    const raw = JSON.parse(await readFile(modelsPath, "utf8"));
    expect(raw.providers["hand-written"]).toEqual({ baseUrl: "https://hand-written.invalid/v1", api: "openai-completions", models: [{ id: "m1" }] });
    expect(raw.providers["apple-pi-added"]).toBeUndefined();
  });
});
