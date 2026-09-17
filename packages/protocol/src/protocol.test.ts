import { describe, expect, expectTypeOf, it } from "vitest";
import {
  decodeCommandResult,
  decodeHostEvent,
  decodeHostMessage,
  decodeHostRecord,
  encodeRecord,
  JsonlDecoder,
  type HostResponse,
  type ModelItem,
} from "./index.js";

describe("host protocol", () => {
  it("accepts a versioned hello command", () => {
    expect(decodeHostMessage({ protocolVersion: 1, requestId: "r1", type: "system.hello", payload: {} })).toEqual({
      protocolVersion: 1,
      requestId: "r1",
      type: "system.hello",
      payload: {},
    });
  });

  it("rejects unknown versions and extra fields", () => {
    expect(() => decodeHostMessage({ protocolVersion: 2, requestId: "r1", type: "system.hello", payload: {} })).toThrow("Unsupported protocol");
    expect(() => decodeHostMessage({ protocolVersion: 1, requestId: "r1", type: "system.hello", payload: {}, shell: true })).toThrow("Invalid host message");
    expect(() => decodeHostMessage({ protocolVersion: 1, requestId: "r1", type: "session.create", payload: { cwd: "/tmp", metadata: 1n } })).toThrow(
      "Invalid host message payload",
    );
  });

  it("decodes records split across arbitrary chunks", () => {
    const decoder = new JsonlDecoder();
    expect(decoder.push('{"a":1}\n{"b"')).toEqual([{ a: 1 }]);
    expect(decoder.push(":2}\n")).toEqual([{ b: 2 }]);
    expect(encodeRecord({ ok: true })).toBe('{"ok":true}\n');
  });

  it("accepts catalog and model commands", () => {
    expect(decodeHostMessage({ protocolVersion: 1, requestId: "r2", type: "session.list", payload: { cwd: "/tmp/project" } }).type).toBe("session.list");
    expect(decodeHostMessage({ protocolVersion: 1, requestId: "r3", type: "model.set", payload: { provider: "openai", modelId: "gpt-5" } }).type).toBe(
      "model.set",
    );
  });

  it("validates bounded cancellable provider commands", () => {
    const request = {
      protocolVersion: 1,
      requestId: "provider",
      type: "provider.connectApiKey",
      payload: { providerId: "openai", apiKey: "secret", operationId: "op-1", timeoutMs: 5_000 },
    } as const;
    expect(decodeHostMessage(request)).toEqual(request);
    expect(() => decodeHostMessage({ ...request, payload: { ...request.payload, timeoutMs: 30_001 } })).toThrow("Invalid host message payload");
    expect(decodeHostMessage({ protocolVersion: 1, requestId: "cancel", type: "operation.cancel", payload: { operationId: "op-1" } }).type).toBe(
      "operation.cancel",
    );
  });

  it("rejects secret-bearing and Pi-shaped provider results", () => {
    const provider = {
      id: "openai",
      name: "OpenAI",
      authMethods: ["api_key"],
      status: "connected",
      credentialSource: "apple_pi",
      availableModelCount: 2,
      diagnostics: [],
    };
    expect(decodeCommandResult("provider.list", [provider])).toEqual([provider]);
    expect(() => decodeCommandResult("provider.list", [{ ...provider, apiKey: "sk-secret" }])).toThrow("Invalid result for provider.list");
    expect(() => decodeCommandResult("provider.list", [{ ...provider, auth: { apiKey: {} } }])).toThrow("Invalid result for provider.list");
    expect(() => decodeCommandResult("provider.list", [{ ...provider, credentialSource: "runtime" }])).toThrow("Invalid result for provider.list");
  });

  it("allows a sanitized secure-storage warning without secret fields", () => {
    const result = { diagnostics: [{ code: "secure_storage_unavailable", severity: "warning", message: "Credential is session-only." }] };
    expect(decodeCommandResult("provider.connectApiKey", result)).toEqual(result);
    expect(() => decodeCommandResult("provider.connectApiKey", { ...result, apiKey: "secret" })).toThrow("Invalid result");
  });

  it("accepts only an empty payload and result for system shutdown", () => {
    expect(decodeHostMessage({ protocolVersion: 1, requestId: "shutdown", type: "system.shutdown", payload: {} })).toEqual({
      protocolVersion: 1,
      requestId: "shutdown",
      type: "system.shutdown",
      payload: {},
    });
    expect(() => decodeHostMessage({ protocolVersion: 1, requestId: "shutdown", type: "system.shutdown", payload: { force: true } })).toThrow(
      "Invalid host message payload",
    );
    expect(decodeCommandResult("system.shutdown", {})).toEqual({});
    expect(() => decodeCommandResult("system.shutdown", { closed: true })).toThrow("Invalid result for system.shutdown");
  });

  it("validates command-specific success results", () => {
    const models = [{ provider: "openai", modelId: "gpt-5", name: "GPT-5" }];
    expect(decodeCommandResult("model.list", models)).toEqual(models);
    expect(() => decodeCommandResult("model.list", { opened: false, messages: [], running: false })).toThrow("Invalid result for model.list");
    expect(() => decodeCommandResult("session.snapshot", { opened: false, messages: [], running: false, rawPiState: {} })).toThrow(
      "Invalid result for session.snapshot",
    );
    expectTypeOf<Extract<HostResponse<"model.list">, { ok: true }>["result"]>().toEqualTypeOf<ModelItem[]>();
  });

  it("validates the complete closed host handshake", () => {
    const hello = {
      protocolVersion: 1,
      // Arbitrary: this fixture asserts the schema shape, not a release. It must
      // not track the application version, or every release has to edit it.
      hostVersion: "0.0.0-fixture",
      piVersion: "0.84.2",
      capabilities: { sessionEvents: true, modelSelection: true, providerManagement: true, cancellableProviderOperations: true, skillManagement: true },
      pid: 42,
    } as const;

    expect(decodeCommandResult("system.hello", hello)).toEqual(hello);
    expect(() => decodeCommandResult("system.hello", { ...hello, piVersion: "" })).toThrow("Invalid result for system.hello");
    expect(() => decodeCommandResult("system.hello", { ...hello, capabilities: { sessionEvents: true } })).toThrow("Invalid result for system.hello");
    expect(() => decodeCommandResult("system.hello", { ...hello, capabilities: { ...hello.capabilities, shellAccess: true } })).toThrow(
      "Invalid result for system.hello",
    );
    expect(() => decodeCommandResult("system.hello", { ...hello, protocolVersion: 2 })).toThrow("Invalid result for system.hello");
  });

  it("validates typed host events", () => {
    const event = { protocolVersion: 1, type: "session.event", sequence: 1, payload: { type: "lifecycle", phase: "started" } } as const;
    expect(decodeHostEvent(event)).toEqual(event);
    expect(() => decodeHostEvent({ ...event, sequence: 0 })).toThrow("Invalid host event");
    expect(() => decodeHostEvent({ ...event, payload: { type: "agent_start" } })).toThrow("Invalid host event");
  });

  it("decodes a command-specific success response", () => {
    const response = {
      protocolVersion: 1,
      requestId: "r-models",
      ok: true,
      result: [{ provider: "openai", modelId: "gpt-5", name: "GPT-5" }],
    } as const;

    expect(decodeHostRecord(response, "model.list")).toEqual(response);
    expect(() => decodeHostRecord({ ...response, result: { opened: false } }, "model.list")).toThrow("Invalid host success response for model.list");
  });

  it("rejects malformed error responses without echoing their content", () => {
    const secret = "sk-private-transcript-fragment";
    let thrown: Error | undefined;

    try {
      decodeHostRecord({ protocolVersion: 1, requestId: "r-error", ok: false, error: secret, transcript: secret }, "session.send");
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.message).toBe("Invalid host error response");
    expect(thrown?.message).not.toContain(secret);
  });

  it("preserves protocol v1 response string compatibility", () => {
    expect(decodeHostRecord({ protocolVersion: 1, requestId: "", ok: false, error: "" })).toEqual({ protocolVersion: 1, requestId: "", ok: false, error: "" });
    expect(
      decodeHostRecord(
        {
          protocolVersion: 1,
          requestId: "",
          ok: true,
          result: { opened: false, messages: [], running: false },
        },
        "session.snapshot",
      ),
    ).toEqual({
      protocolVersion: 1,
      requestId: "",
      ok: true,
      result: { opened: false, messages: [], running: false },
    });
  });

  it("validates bounded OAuth login and prompt-response commands", () => {
    const start = {
      protocolVersion: 1,
      requestId: "oauth-start",
      type: "provider.startOAuthLogin",
      payload: { providerId: "openai-codex", operationId: "op-1", timeoutMs: 600_000 },
    } as const;
    expect(decodeHostMessage(start)).toEqual(start);
    expect(() => decodeHostMessage({ ...start, payload: { ...start.payload, timeoutMs: 1_200_001 } })).toThrow("Invalid host message payload");
    expect(() => decodeHostMessage({ ...start, payload: { ...start.payload, timeoutMs: 40_000 } })).not.toThrow();

    const respond = {
      protocolVersion: 1,
      requestId: "oauth-respond",
      type: "provider.respondOAuthPrompt",
      payload: { operationId: "op-1", promptId: "prompt-1", value: "browser" },
    } as const;
    expect(decodeHostMessage(respond)).toEqual(respond);

    expect(decodeCommandResult("provider.startOAuthLogin", { diagnostics: [] })).toEqual({ diagnostics: [] });
    expect(decodeCommandResult("provider.respondOAuthPrompt", { accepted: true })).toEqual({ accepted: true });
    expect(() => decodeCommandResult("provider.respondOAuthPrompt", { accepted: true, promptId: "leak" })).toThrow(
      "Invalid result for provider.respondOAuthPrompt",
    );
  });

  it("validates the custom provider management commands", () => {
    const definition = {
      id: "my-local-llm",
      name: "My Local LLM",
      baseUrl: "https://localhost:8080/v1",
      api: "openai-completions",
      models: [{ id: "local-model-a" }],
    } as const;
    const add = {
      protocolVersion: 1,
      requestId: "add-1",
      type: "provider.addCustom",
      payload: { definition, operationId: "op-1", timeoutMs: 15_000 },
    } as const;
    expect(decodeHostMessage(add)).toEqual(add);
    expect(() => decodeHostMessage({ ...add, payload: { ...add.payload, definition: { ...definition, apiKey: "sk-leak" } } })).toThrow(
      "Invalid host message payload",
    );

    const update = {
      protocolVersion: 1,
      requestId: "update-1",
      type: "provider.updateCustom",
      payload: { id: "my-local-llm", definition, operationId: "op-2", timeoutMs: 15_000 },
    } as const;
    expect(decodeHostMessage(update)).toEqual(update);

    const remove = {
      protocolVersion: 1,
      requestId: "remove-1",
      type: "provider.removeCustom",
      payload: { id: "my-local-llm", operationId: "op-3", timeoutMs: 15_000 },
    } as const;
    expect(decodeHostMessage(remove)).toEqual(remove);

    const list = { protocolVersion: 1, requestId: "list-1", type: "provider.listCustom", payload: {} } as const;
    expect(decodeHostMessage(list)).toEqual(list);

    expect(decodeCommandResult("provider.listCustom", [definition])).toEqual([definition]);
    expect(decodeCommandResult("provider.addCustom", { diagnostics: [] })).toEqual({ diagnostics: [] });
    expect(decodeCommandResult("provider.updateCustom", { diagnostics: [] })).toEqual({ diagnostics: [] });
    expect(decodeCommandResult("provider.removeCustom", { diagnostics: [] })).toEqual({ diagnostics: [] });
  });

  it("validates a provider auth event pushed while a login operation is running", () => {
    const event = {
      protocolVersion: 1,
      type: "provider.authEvent",
      operationId: "op-1",
      payload: { type: "auth_url", url: "https://auth.openai.com/oauth/authorize" },
    } as const;
    expect(decodeHostEvent(event)).toEqual(event);
    expect(() => decodeHostEvent({ ...event, operationId: "" })).toThrow("Invalid host event");
    expect(() => decodeHostEvent({ ...event, payload: { type: "unknown" } })).toThrow("Invalid host event");
    // A session event still decodes correctly now that HostEventSchema is a union.
    expect(decodeHostEvent({ protocolVersion: 1, type: "session.event", sequence: 1, payload: { type: "lifecycle", phase: "started" } })).toEqual({
      protocolVersion: 1,
      type: "session.event",
      sequence: 1,
      payload: { type: "lifecycle", phase: "started" },
    });
  });

  it("validates the skill.listDisabled command, kept separate from skill.list's SkillCatalog result", () => {
    const message = {
      protocolVersion: 1,
      requestId: "skill-list-disabled",
      type: "skill.listDisabled",
      payload: { cwd: "/workspace" },
    } as const;
    expect(decodeHostMessage(message)).toEqual(message);
    expect(() => decodeHostMessage({ ...message, payload: {} })).toThrow("Invalid host message payload");

    const disabledSkill = {
      name: "pdf-forms",
      description: "Fill and flatten PDF forms.",
      scope: "user",
      path: "/home/jane/.pi/agent/skills-disabled/pdf-forms/SKILL.md",
      disableModelInvocation: true,
      managed: true,
    } as const;
    expect(decodeCommandResult("skill.listDisabled", [disabledSkill])).toEqual([disabledSkill]);
    expect(() => decodeCommandResult("skill.listDisabled", { skills: [disabledSkill], diagnostics: [] })).toThrow("Invalid result for skill.listDisabled");
  });

  it("rejects unknown event types and invalid event sequences", () => {
    expect(() =>
      decodeHostRecord({
        protocolVersion: 1,
        type: "session.event",
        sequence: 1,
        payload: { type: "agent_start" },
      }),
    ).toThrow("Invalid host event");
    expect(() =>
      decodeHostRecord({
        protocolVersion: 1,
        type: "session.event",
        sequence: 0,
        payload: { type: "lifecycle", phase: "started" },
      }),
    ).toThrow("Invalid host event");
  });
});
