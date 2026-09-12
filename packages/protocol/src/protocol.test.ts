import { describe, expect, expectTypeOf, it } from "vitest";
import { decodeCommandResult, decodeHostEvent, decodeHostMessage, encodeRecord, JsonlDecoder, type HostResponse, type ModelItem } from "./index.js";

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

  it("validates command-specific success results", () => {
    const models = [{ provider: "openai", modelId: "gpt-5", name: "GPT-5" }];
    expect(decodeCommandResult("model.list", models)).toEqual(models);
    expect(() => decodeCommandResult("model.list", { opened: false, messages: [], running: false })).toThrow("Invalid result for model.list");
    expect(() => decodeCommandResult("session.snapshot", { opened: false, messages: [], running: false, rawPiState: {} })).toThrow("Invalid result for session.snapshot");
    expectTypeOf<Extract<HostResponse<"model.list">, { ok: true }>["result"]>().toEqualTypeOf<ModelItem[]>();
  });

  it("validates typed host events", () => {
    const event = { protocolVersion: 1, type: "session.event", sequence: 1, payload: { type: "lifecycle", phase: "started" } } as const;
    expect(decodeHostEvent(event)).toEqual(event);
    expect(() => decodeHostEvent({ ...event, sequence: 0 })).toThrow("Invalid host event");
    expect(() => decodeHostEvent({ ...event, payload: { type: "agent_start" } })).toThrow("Invalid host event");
  });
});
