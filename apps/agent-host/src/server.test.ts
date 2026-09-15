import { describe, expect, it, vi } from "vitest";
import hostPackage from "../package.json" with { type: "json" };
import { HOST_VERSION, HostServer } from "./server.js";

describe("HostServer", () => {
  it("waits for Pi ownership release before acknowledging shutdown", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { close: () => Promise<void> } }).pi;
    let release!: () => void;
    const closing = new Promise<void>((resolve) => { release = resolve; });
    service.close = vi.fn(() => closing);

    const response = server.handle({ protocolVersion: 1, requestId: "shutdown", type: "system.shutdown", payload: {} });
    let settled = false;
    void response.then(() => { settled = true; });
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
    await expect(server.handle({ protocolVersion: 1, requestId: "open", type: "session.open", payload: { cwd: "/workspace" } }))
      .resolves.toEqual({ protocolVersion: 1, requestId: "open", ok: false, error: "Agent host is shutting down" });
    expect(service.open).not.toHaveBeenCalled();
  });

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
          hostVersion: "0.2.0",
          piVersion: "0.84.2",
          capabilities: { sessionEvents: true, modelSelection: true, providerManagement: true, cancellableProviderOperations: true },
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

  it("sanitizes provider failures before they cross the host boundary", async () => {
    const server = new HostServer();
    const service = (server as unknown as { pi: { providers: { list: () => Promise<unknown> } } }).pi.providers;
    service.list = vi.fn(async () => { throw new Error("sk-private provider response"); });

    const response = await server.handle({ protocolVersion: 1, requestId: "providers", type: "provider.list", payload: {} });

    expect(response).toEqual({ protocolVersion: 1, requestId: "providers", ok: false, error: "Provider operation failed" });
    expect(JSON.stringify(response)).not.toContain("sk-private");
  });
});
