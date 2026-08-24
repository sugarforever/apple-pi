import { describe, expect, it } from "vitest";
import { decodeHostMessage, encodeRecord, JsonlDecoder } from "./index.js";

describe("host protocol", () => {
  it("accepts a versioned hello command", () => {
    expect(decodeHostMessage({ protocolVersion: 1, requestId: "r1", type: "system.hello", payload: {} })).toEqual({
      protocolVersion: 1, requestId: "r1", type: "system.hello", payload: {},
    });
  });

  it("rejects unknown versions and extra fields", () => {
    expect(() => decodeHostMessage({ protocolVersion: 2, requestId: "r1", type: "system.hello", payload: {} })).toThrow("Unsupported protocol");
    expect(() => decodeHostMessage({ protocolVersion: 1, requestId: "r1", type: "system.hello", payload: {}, shell: true })).toThrow("Invalid host message");
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
});
