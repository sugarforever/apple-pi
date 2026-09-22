import { describe, expect, it, vi } from "vitest";
import hostPackage from "../package.json" with { type: "json" };
import { HOST_VERSION, HostServer } from "./server.js";

describe("HostServer", () => {
  it("waits for Pi ownership release before acknowledging shutdown", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { close: () => Promise<void> } }).pi;
    let release!: () => void;
    const closing = new Promise<void>((resolve) => {
      release = resolve;
    });
    service.close = vi.fn(() => closing);

    const response = server.handle({ protocolVersion: 1, requestId: "shutdown", type: "system.shutdown", payload: {} });
    let settled = false;
    void response.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await expect(response).resolves.toEqual({ protocolVersion: 1, requestId: "shutdown", ok: true, result: {} });
    expect(service.close).toHaveBeenCalledOnce();
  });

  it("rejects session creation after shutdown becomes terminal", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { close: () => Promise<void>; open: ReturnType<typeof vi.fn> } }).pi;
    service.close = vi.fn(async () => {});
    service.open = vi.fn(async () => ({ opened: false, messages: [], running: false }));

    await server.handle({ protocolVersion: 1, requestId: "shutdown", type: "system.shutdown", payload: {} });
    await expect(server.handle({ protocolVersion: 1, requestId: "open", type: "session.open", payload: { cwd: "/workspace" } })).resolves.toEqual({
      protocolVersion: 1,
      requestId: "open",
      ok: false,
      error: "Agent host is shutting down",
    });
    expect(service.open).not.toHaveBeenCalled();
  });

  it("reports exact versions and named capabilities", async () => {
    expect(HOST_VERSION).toBe(hostPackage.version);
    const server = new HostServer();
    await expect(server.handle({ protocolVersion: 1, requestId: "1", type: "system.hello", payload: {} })).resolves.toEqual({
      protocolVersion: 1,
      requestId: "1",
      ok: true,
      result: {
        protocolVersion: 1,
        hostVersion: HOST_VERSION,
        piVersion: "0.84.2",
        capabilities: {
          sessionEvents: true,
          modelSelection: true,
          providerManagement: true,
          cancellableProviderOperations: true,
          skillManagement: true,
        },
        pid: process.pid,
      },
    });
  });

  it("converts a malformed success result into a deterministic protocol fault", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { snapshot: () => unknown } }).pi;
    service.snapshot = () => ({ opened: false, transcript: "private conversation" });

    await expect(server.handle({ protocolVersion: 1, requestId: "bad-result", type: "session.snapshot", payload: {} })).resolves.toEqual({
      protocolVersion: 1,
      requestId: "bad-result",
      ok: false,
      error: "Agent host protocol fault",
    });
  });

  it("validates events before exposing them to the JSONL writer", () => {
    const events: unknown[] = [];
    const server = new HostServer((event) => events.push(event));
    const service = (server as unknown as { pi: { listener: (event: unknown) => void } }).pi;

    expect(() => service.listener({ type: "agent_start", transcript: "private conversation" })).toThrow("Agent host protocol fault");
    expect(events).toEqual([]);
  });

  it("does not relabel a JSONL writer failure as a protocol fault", () => {
    const server = new HostServer(() => {
      throw new Error("writer failed");
    });
    const service = (server as unknown as { pi: { listener: (event: unknown) => void } }).pi;

    expect(() => service.listener({ type: "lifecycle", phase: "started" })).toThrow("writer failed");
  });

  it("emits a schema-valid fallback for an empty error response", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { snapshot: () => unknown } }).pi;
    service.snapshot = () => {
      throw new Error("");
    };

    await expect(server.handle({ protocolVersion: 1, requestId: "empty-error", type: "session.snapshot", payload: {} })).resolves.toEqual({
      protocolVersion: 1,
      requestId: "empty-error",
      ok: false,
      error: "Agent host request failed",
    });
  });

  it("sanitizes provider failures before they cross the host boundary", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { providers: { list: () => Promise<unknown> } } }).pi.providers;
    service.list = vi.fn(async () => {
      throw new Error("sk-private provider response");
    });

    const response = await server.handle({ protocolVersion: 1, requestId: "providers", type: "provider.list", payload: {} });

    expect(response).toEqual({ protocolVersion: 1, requestId: "providers", ok: false, error: "Provider operation failed" });
    expect(JSON.stringify(response)).not.toContain("sk-private");
  });

  it("pushes provider auth events for an in-flight OAuth login under that operation's id", async () => {
    const events: unknown[] = [];
    const server = new HostServer((event) => events.push(event));
    const service = (
      server as unknown as {
        pi: { providers: { oauthLogin: (providerId: string, operationId: string, timeoutMs: number, onEvent: (event: unknown) => void) => Promise<unknown> } };
      }
    ).pi.providers;
    service.oauthLogin = vi.fn(async (_providerId, _operationId, _timeoutMs, onEvent) => {
      onEvent({ type: "auth_url", url: "https://auth.openai.com/oauth/authorize" });
      onEvent({ type: "progress", message: "Waiting for authentication..." });
      return { diagnostics: [] };
    });

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "oauth-start",
      type: "provider.startOAuthLogin",
      payload: { providerId: "openai-codex", operationId: "op-1", timeoutMs: 60_000 },
    });

    expect(response).toEqual({ protocolVersion: 1, requestId: "oauth-start", ok: true, result: { diagnostics: [] } });
    expect(events).toEqual([
      { protocolVersion: 1, type: "provider.authEvent", operationId: "op-1", payload: { type: "auth_url", url: "https://auth.openai.com/oauth/authorize" } },
      { protocolVersion: 1, type: "provider.authEvent", operationId: "op-1", payload: { type: "progress", message: "Waiting for authentication..." } },
    ]);
  });

  it("routes a prompt response to the provider service and reports whether it was accepted", async () => {
    const server = new HostServer();
    const service = (
      server as unknown as {
        pi: { providers: { respondOAuthPrompt: (operationId: string, promptId: string, value: string) => boolean } };
      }
    ).pi.providers;
    service.respondOAuthPrompt = vi.fn(() => true);

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "oauth-respond",
      type: "provider.respondOAuthPrompt",
      payload: { operationId: "op-1", promptId: "prompt-1", value: "browser" },
    });

    expect(response).toEqual({ protocolVersion: 1, requestId: "oauth-respond", ok: true, result: { accepted: true } });
    expect(service.respondOAuthPrompt).toHaveBeenCalledWith("op-1", "prompt-1", "browser");
  });

  it("sanitizes an OAuth login failure the same way as other provider operations", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { providers: { oauthLogin: () => Promise<unknown> } } }).pi.providers;
    service.oauthLogin = vi.fn(async () => {
      throw new Error("sk-private oauth failure");
    });

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "oauth-fail",
      type: "provider.startOAuthLogin",
      payload: { providerId: "openai-codex", operationId: "op-1", timeoutMs: 60_000 },
    });

    expect(response).toEqual({ protocolVersion: 1, requestId: "oauth-fail", ok: false, error: "Provider operation failed" });
    expect(JSON.stringify(response)).not.toContain("sk-private");
  });

  it("never lets a malformed auth event reach the JSONL writer, sanitizing it like any other provider failure", async () => {
    // Unlike a session event (pushed from a detached subscription outside any
    // request's call stack), an auth event is pushed synchronously from within
    // this `provider.startOAuthLogin` request, so its `HostProtocolFault` is
    // caught by the same try/catch as any other provider operation failure.
    const events: unknown[] = [];
    const server = new HostServer((event) => events.push(event));
    const service = (
      server as unknown as {
        pi: { providers: { oauthLogin: (providerId: string, operationId: string, timeoutMs: number, onEvent: (event: unknown) => void) => Promise<unknown> } };
      }
    ).pi.providers;
    service.oauthLogin = vi.fn(async (_providerId, _operationId, _timeoutMs, onEvent) => {
      onEvent({ type: "unknown_event_kind" });
      return { diagnostics: [] };
    });

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "oauth-bad-event",
      type: "provider.startOAuthLogin",
      payload: { providerId: "openai-codex", operationId: "op-1", timeoutMs: 60_000 },
    });

    expect(response).toEqual({ protocolVersion: 1, requestId: "oauth-bad-event", ok: false, error: "Provider operation failed" });
    expect(events).toEqual([]);
  });

  const customDefinition = {
    id: "my-local-llm",
    name: "My Local LLM",
    baseUrl: "https://localhost:8080/v1",
    api: "openai-completions",
    models: [{ id: "local-model-a" }],
  };

  it("lists custom providers from the provider service", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { providers: { listCustomProviders: () => Promise<unknown> } } }).pi.providers;
    service.listCustomProviders = vi.fn(async () => [customDefinition]);

    const response = await server.handle({ protocolVersion: 1, requestId: "list-custom", type: "provider.listCustom", payload: {} });

    expect(response).toEqual({ protocolVersion: 1, requestId: "list-custom", ok: true, result: [customDefinition] });
  });

  it("routes add/update/remove custom provider commands to the provider service", async () => {
    const server = new HostServer();
    const service = (
      server as unknown as {
        pi: {
          providers: {
            addCustomProvider: (...args: unknown[]) => Promise<unknown>;
            updateCustomProvider: (...args: unknown[]) => Promise<unknown>;
            removeCustomProvider: (...args: unknown[]) => Promise<unknown>;
          };
        };
      }
    ).pi.providers;
    service.addCustomProvider = vi.fn(async () => ({ diagnostics: [] }));
    service.updateCustomProvider = vi.fn(async () => ({ diagnostics: [] }));
    service.removeCustomProvider = vi.fn(async () => ({ diagnostics: [] }));

    await server.handle({
      protocolVersion: 1,
      requestId: "add-custom",
      type: "provider.addCustom",
      payload: { definition: customDefinition, operationId: "op-1", timeoutMs: 5_000 },
    });
    expect(service.addCustomProvider).toHaveBeenCalledWith(customDefinition, "op-1", 5_000);

    await server.handle({
      protocolVersion: 1,
      requestId: "update-custom",
      type: "provider.updateCustom",
      payload: { id: "my-local-llm", definition: customDefinition, operationId: "op-2", timeoutMs: 5_000 },
    });
    expect(service.updateCustomProvider).toHaveBeenCalledWith("my-local-llm", customDefinition, "op-2", 5_000);

    await server.handle({
      protocolVersion: 1,
      requestId: "remove-custom",
      type: "provider.removeCustom",
      payload: { id: "my-local-llm", operationId: "op-3", timeoutMs: 5_000 },
    });
    expect(service.removeCustomProvider).toHaveBeenCalledWith("my-local-llm", "op-3", 5_000);
  });

  it("sanitizes a custom provider operation failure the same way as other provider operations", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { providers: { addCustomProvider: () => Promise<unknown> } } }).pi.providers;
    service.addCustomProvider = vi.fn(async () => {
      throw new Error("sk-private failure");
    });

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "add-custom-fail",
      type: "provider.addCustom",
      payload: { definition: customDefinition, operationId: "op-1", timeoutMs: 5_000 },
    });

    expect(response).toEqual({ protocolVersion: 1, requestId: "add-custom-fail", ok: false, error: "Provider operation failed" });
    expect(JSON.stringify(response)).not.toContain("sk-private");
  });

  const sampleSkill = {
    name: "my-skill",
    description: "Does something useful.",
    scope: "project" as const,
    path: "/workspace/.pi/skills/my-skill/SKILL.md",
    disableModelInvocation: false,
    managed: true,
  };

  it("lists skills from the skill service", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { skills: { list: (cwd: string, scopes: string[]) => Promise<unknown> } } }).pi.skills;
    service.list = vi.fn(async () => ({ skills: [sampleSkill], diagnostics: [] }));

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "skill-list",
      type: "skill.list",
      payload: { cwd: "/workspace", scopes: ["project"] },
    });

    expect(response).toEqual({ protocolVersion: 1, requestId: "skill-list", ok: true, result: { skills: [sampleSkill], diagnostics: [] } });
    expect(service.list).toHaveBeenCalledWith("/workspace", ["project"]);
  });

  // `cwd` is optional on skill.list -- unlike every other skill.* command --
  // because user-scope skills have nothing to do with any project, and
  // Settings is reachable with zero workspaces open (see issue #68: "Global
  // (user-scope) skills are invisible in Settings unless a workspace is
  // open"). A payload with no `cwd` at all is therefore valid, not malformed:
  // it reaches the skill service as `undefined`, which tells PiSkillService
  // to report user-scope skills only.
  it("routes a skill.list payload with no cwd to the skill service as undefined, for user-scope-only discovery", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { skills: { list: (cwd: string | undefined, scopes: string[]) => Promise<unknown> } } }).pi.skills;
    const userSkill = { ...sampleSkill, scope: "user" as const, path: "/home/jane/.pi/agent/skills/my-skill/SKILL.md" };
    service.list = vi.fn(async () => ({ skills: [userSkill], diagnostics: [] }));

    const response = await server.handle({ protocolVersion: 1, requestId: "skill-list-no-cwd", type: "skill.list", payload: { scopes: ["user"] } });

    expect(response).toEqual({ protocolVersion: 1, requestId: "skill-list-no-cwd", ok: true, result: { skills: [userSkill], diagnostics: [] } });
    expect(service.list).toHaveBeenCalledExactlyOnceWith(undefined, ["user"]);
  });

  it("rejects a genuinely malformed skill.list payload (an empty-string cwd) before it reaches the skill service", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { skills: { list: (cwd?: string) => Promise<unknown> } } }).pi.skills;
    service.list = vi.fn(async () => ({ skills: [], diagnostics: [] }));

    const response = await server.handle({ protocolVersion: 1, requestId: "skill-list-bad", type: "skill.list", payload: { cwd: "", scopes: ["user"] } });

    expect(response).toMatchObject({ ok: false });
    expect(service.list).not.toHaveBeenCalled();
  });

  it("lists disabled skills from the skill service, kept separate from skill.list", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { skills: { listDisabled: (cwd: string, scopes: string[]) => Promise<unknown> } } }).pi.skills;
    const disabledSkill = { ...sampleSkill, disableModelInvocation: true };
    service.listDisabled = vi.fn(async () => [disabledSkill]);

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "skill-list-disabled",
      type: "skill.listDisabled",
      payload: { cwd: "/workspace", scopes: ["project"] },
    });

    expect(response).toEqual({ protocolVersion: 1, requestId: "skill-list-disabled", ok: true, result: [disabledSkill] });
    expect(service.listDisabled).toHaveBeenCalledWith("/workspace", ["project"]);
  });

  it("rejects a malformed skill.listDisabled payload before it reaches the skill service", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { skills: { listDisabled: (cwd: string) => Promise<unknown> } } }).pi.skills;
    service.listDisabled = vi.fn(async () => []);

    const response = await server.handle({ protocolVersion: 1, requestId: "skill-list-disabled-bad", type: "skill.listDisabled", payload: { scopes: [] } });

    expect(response).toMatchObject({ ok: false });
    expect(service.listDisabled).not.toHaveBeenCalled();
  });

  it("sanitizes a skill.listDisabled failure the same way as other skill commands", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { skills: { listDisabled: () => Promise<unknown> } } }).pi.skills;
    service.listDisabled = vi.fn(async () => {
      throw new Error("/Users/private-user/secret-project/.pi/skills-disabled failure");
    });

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "skill-list-disabled-fail",
      type: "skill.listDisabled",
      payload: { cwd: "/workspace", scopes: ["project"] },
    });

    expect(response).toEqual({ protocolVersion: 1, requestId: "skill-list-disabled-fail", ok: false, error: "Skill operation failed" });
  });

  it("routes skill install requests to the skill service", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { skills: { install: (sourcePath: string, scope: string, cwd: string) => Promise<unknown> } } }).pi.skills;
    service.install = vi.fn(async () => ({ skill: sampleSkill, diagnostics: [] }));

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "skill-install",
      type: "skill.install",
      payload: { cwd: "/workspace", scope: "project", sourcePath: "/tmp/candidate-skill" },
    });

    expect(response).toEqual({ protocolVersion: 1, requestId: "skill-install", ok: true, result: { skill: sampleSkill, diagnostics: [] } });
    expect(service.install).toHaveBeenCalledWith("/tmp/candidate-skill", "project", "/workspace");
  });

  it("rejects a malformed skill.install payload before it reaches the skill service", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { skills: { install: () => Promise<unknown> } } }).pi.skills;
    service.install = vi.fn(async () => ({ diagnostics: [] }));

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "skill-install-bad",
      type: "skill.install",
      payload: { cwd: "/workspace", scope: "admin", sourcePath: "/tmp/candidate-skill" },
    });

    expect(response).toMatchObject({ ok: false });
    expect(service.install).not.toHaveBeenCalled();
  });

  it("routes skill setEnabled requests to the skill service", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { skills: { setEnabled: (name: string, scope: string, cwd: string, enabled: boolean) => Promise<unknown> } } })
      .pi.skills;
    service.setEnabled = vi.fn(async () => ({ skill: sampleSkill, diagnostics: [] }));

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "skill-set-enabled",
      type: "skill.setEnabled",
      payload: { cwd: "/workspace", scope: "project", name: "my-skill", enabled: false },
    });

    expect(response).toEqual({ protocolVersion: 1, requestId: "skill-set-enabled", ok: true, result: { skill: sampleSkill, diagnostics: [] } });
    expect(service.setEnabled).toHaveBeenCalledWith("my-skill", "project", "/workspace", false);
  });

  it("rejects a malformed skill.setEnabled payload before it reaches the skill service", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { skills: { setEnabled: () => Promise<unknown> } } }).pi.skills;
    service.setEnabled = vi.fn(async () => ({ diagnostics: [] }));

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "skill-set-enabled-bad",
      type: "skill.setEnabled",
      payload: { cwd: "/workspace", scope: "project", name: "my-skill", enabled: "false" },
    });

    expect(response).toMatchObject({ ok: false });
    expect(service.setEnabled).not.toHaveBeenCalled();
  });

  it("routes skill remove requests to the skill service", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { skills: { remove: (name: string, scope: string, cwd: string) => Promise<unknown> } } }).pi.skills;
    service.remove = vi.fn(async () => ({ skill: sampleSkill, diagnostics: [] }));

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "skill-remove",
      type: "skill.remove",
      payload: { cwd: "/workspace", scope: "project", name: "my-skill" },
    });

    expect(response).toEqual({ protocolVersion: 1, requestId: "skill-remove", ok: true, result: { skill: sampleSkill, diagnostics: [] } });
    expect(service.remove).toHaveBeenCalledWith("my-skill", "project", "/workspace");
  });

  it("rejects a malformed skill.remove payload before it reaches the skill service", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { skills: { remove: () => Promise<unknown> } } }).pi.skills;
    service.remove = vi.fn(async () => ({ diagnostics: [] }));

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "skill-remove-bad",
      type: "skill.remove",
      payload: { cwd: "/workspace", scope: "project" },
    });

    expect(response).toMatchObject({ ok: false });
    expect(service.remove).not.toHaveBeenCalled();
  });

  it("sanitizes skill operation failures before they cross the host boundary", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { skills: { list: () => Promise<unknown> } } }).pi.skills;
    service.list = vi.fn(async () => {
      throw new Error("/Users/private-user/secret-project/.pi/skills failure");
    });

    const response = await server.handle({
      protocolVersion: 1,
      requestId: "skill-list-fail",
      type: "skill.list",
      payload: { cwd: "/workspace", scopes: ["project"] },
    });

    expect(response).toEqual({ protocolVersion: 1, requestId: "skill-list-fail", ok: false, error: "Skill operation failed" });
    expect(JSON.stringify(response)).not.toContain("private-user");
  });
});
