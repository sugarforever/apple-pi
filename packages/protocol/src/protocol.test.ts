import { describe, expect, expectTypeOf, it } from "vitest";
import { decodeCommandResult, decodeHostEvent, decodeHostMessage, decodeHostRecord, encodeRecord, JsonlDecoder, type HostResponse, type ModelItem } from "./index.js";

describe("host protocol", () => {
  it("accepts a versioned hello command", () => {
    expect(decodeHostMessage({ protocolVersion: 1, requestId: "r1", type: "system.hello", payload: {} })).toEqual({
      protocolVersion: 1, requestId: "r1", type: "system.hello", payload: {},
    });
  });

  it("rejects unknown versions and extra fields", () => {
    expect(() => decodeHostMessage({ protocolVersion: 2, requestId: "r1", type: "system.hello", payload: {} })).toThrow("Unsupported protocol");
    expect(() => decodeHostMessage({ protocolVersion: 1, requestId: "r1", type: "system.hello", payload: {}, shell: true })).toThrow("Invalid host message");
    expect(() => decodeHostMessage({ protocolVersion: 1, requestId: "r1", type: "session.create", payload: { cwd: "/tmp", metadata: 1n } })).toThrow("Invalid host message payload");
  });

  it("decodes records split across arbitrary chunks", () => {
    const decoder = new JsonlDecoder();
    expect(decoder.push('{"a":1}\n{"b"')).toEqual([{ a: 1 }]);
    expect(decoder.push(':2}\n')).toEqual([{ b: 2 }]);
    expect(encodeRecord({ ok: true })).toBe('{"ok":true}\n');
  });

  it("accepts catalog and model commands", () => {
    expect(decodeHostMessage({ protocolVersion: 1, requestId: "r2", type: "session.list", payload: { cwd: "/tmp/project" } }).type).toBe("session.list");
    expect(decodeHostMessage({ protocolVersion: 1, requestId: "r3", type: "model.set", payload: { provider: "openai", modelId: "gpt-5" } }).type).toBe("model.set");
  });

  it("validates bounded cancellable provider commands", () => {
    const request = { protocolVersion: 1, requestId: "provider", type: "provider.connectApiKey", payload: { providerId: "openai", apiKey: "secret", operationId: "op-1", timeoutMs: 5_000 } } as const;
    expect(decodeHostMessage(request)).toEqual(request);
    expect(() => decodeHostMessage({ ...request, payload: { ...request.payload, timeoutMs: 30_001 } })).toThrow("Invalid host message payload");
    expect(decodeHostMessage({ protocolVersion: 1, requestId: "cancel", type: "operation.cancel", payload: { operationId: "op-1" } }).type).toBe("operation.cancel");
  });

  it("rejects secret-bearing and Pi-shaped provider results", () => {
    const provider = { id: "openai", name: "OpenAI", authMethods: ["api_key"], status: "connected", credentialSource: "apple_pi", availableModelCount: 2, diagnostics: [] };
    expect(decodeCommandResult("provider.list", [provider])).toEqual([provider]);
    expect(() => decodeCommandResult("provider.list", [{ ...provider, apiKey: "sk-secret" }])).toThrow("Invalid result for provider.list");
    expect(() => decodeCommandResult("provider.list", [{ ...provider, auth: { apiKey: {} } }])).toThrow("Invalid result for provider.list");
    expect(() => decodeCommandResult("provider.list", [{ ...provider, credentialSource: "runtime" }])).toThrow("Invalid result for provider.list");
  });

  it("accepts only an empty payload and result for system shutdown", () => {
    expect(decodeHostMessage({ protocolVersion: 1, requestId: "shutdown", type: "system.shutdown", payload: {} }))
      .toEqual({ protocolVersion: 1, requestId: "shutdown", type: "system.shutdown", payload: {} });
    expect(() => decodeHostMessage({ protocolVersion: 1, requestId: "shutdown", type: "system.shutdown", payload: { force: true } }))
      .toThrow("Invalid host message payload");
    expect(decodeCommandResult("system.shutdown", {})).toEqual({});
    expect(() => decodeCommandResult("system.shutdown", { closed: true })).toThrow("Invalid result for system.shutdown");
  });

  it("validates command-specific success results", () => {
    const models = [{ provider: "openai", modelId: "gpt-5", name: "GPT-5" }];
    expect(decodeCommandResult("model.list", models)).toEqual(models);
    expect(() => decodeCommandResult("model.list", { opened: false, messages: [], running: false })).toThrow("Invalid result for model.list");
    expect(() => decodeCommandResult("session.snapshot", { opened: false, messages: [], running: false, rawPiState: {} })).toThrow("Invalid result for session.snapshot");
    expectTypeOf<Extract<HostResponse<"model.list">, { ok: true }>["result"]>().toEqualTypeOf<ModelItem[]>();
  });

  it("validates the complete closed host handshake", () => {
    const hello = {
      protocolVersion: 1,
      hostVersion: "0.1.0",
      piVersion: "0.84.2",
      capabilities: { sessionEvents: true, modelSelection: true, providerManagement: true, cancellableProviderOperations: true },
      pid: 42,
    } as const;

    expect(decodeCommandResult("system.hello", hello)).toEqual(hello);
    expect(() => decodeCommandResult("system.hello", { ...hello, piVersion: "" })).toThrow("Invalid result for system.hello");
    expect(() => decodeCommandResult("system.hello", { ...hello, capabilities: { sessionEvents: true } })).toThrow("Invalid result for system.hello");
    expect(() => decodeCommandResult("system.hello", { ...hello, capabilities: { ...hello.capabilities, shellAccess: true } })).toThrow("Invalid result for system.hello");
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
    expect(() => decodeHostRecord({ ...response, result: { opened: false } }, "model.list"))
      .toThrow("Invalid host success response for model.list");
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
    expect(decodeHostRecord({ protocolVersion: 1, requestId: "", ok: false, error: "" }))
      .toEqual({ protocolVersion: 1, requestId: "", ok: false, error: "" });
    expect(decodeHostRecord({
      protocolVersion: 1,
      requestId: "",
      ok: true,
      result: { opened: false, messages: [], running: false },
    }, "session.snapshot")).toEqual({
      protocolVersion: 1,
      requestId: "",
      ok: true,
      result: { opened: false, messages: [], running: false },
    });
  });

  it("rejects unknown event types and invalid event sequences", () => {
    expect(() => decodeHostRecord({
      protocolVersion: 1,
      type: "session.event",
      sequence: 1,
      payload: { type: "agent_start" },
    })).toThrow("Invalid host event");
    expect(() => decodeHostRecord({
      protocolVersion: 1,
      type: "session.event",
      sequence: 0,
      payload: { type: "lifecycle", phase: "started" },
    })).toThrow("Invalid host event");
  });
});
