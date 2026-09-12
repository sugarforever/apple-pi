import { describe, expect, it } from "vitest";
import hostPackage from "../package.json" with { type: "json" };
import { HOST_VERSION, HostServer } from "./server.js";

describe("HostServer", () => {
  it("reports exact versions and named capabilities", async () => {
    expect(HOST_VERSION).toBe(hostPackage.version);
    const server = new HostServer();
    await expect(server.handle({ protocolVersion: 1, requestId: "1", type: "system.hello", payload: {} }))
      .resolves.toEqual({
        protocolVersion: 1,
        requestId: "1",
        ok: true,
        result: {
          protocolVersion: 1,
          hostVersion: "0.1.0",
          piVersion: "0.84.2",
          capabilities: { sessionEvents: true, modelSelection: true },
          pid: process.pid,
        },
      });
  });

  it("converts a malformed success result into a deterministic protocol fault", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { snapshot: () => unknown } }).pi;
    service.snapshot = () => ({ opened: false, transcript: "private conversation" });

    await expect(server.handle({ protocolVersion: 1, requestId: "bad-result", type: "session.snapshot", payload: {} }))
      .resolves.toEqual({
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

    expect(() => service.listener({ type: "agent_start", transcript: "private conversation" }))
      .toThrow("Agent host protocol fault");
    expect(events).toEqual([]);
  });

  it("does not relabel a JSONL writer failure as a protocol fault", () => {
    const server = new HostServer(() => { throw new Error("writer failed"); });
    const service = (server as unknown as { pi: { listener: (event: unknown) => void } }).pi;

    expect(() => service.listener({ type: "lifecycle", phase: "started" }))
      .toThrow("writer failed");
  });

  it("emits a schema-valid fallback for an empty error response", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { snapshot: () => unknown } }).pi;
    service.snapshot = () => { throw new Error(""); };

    await expect(server.handle({ protocolVersion: 1, requestId: "empty-error", type: "session.snapshot", payload: {} }))
      .resolves.toEqual({
        protocolVersion: 1,
        requestId: "empty-error",
        ok: false,
        error: "Agent host request failed",
      });
  });
});
