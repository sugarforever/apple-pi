import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { AgentHostSupervisor } from "./agent-host-supervisor.js";
import { validateHostHandshake } from "./host-compatibility.js";

const compatibleHandshake = {
  protocolVersion: 1,
  hostVersion: "0.1.0",
  piVersion: "0.84.2",
  capabilities: { sessionEvents: true, modelSelection: true },
  pid: 42,
} as const;

describe("agent host supervisor handshake", () => {
  it("marks the host ready only after a compatible handshake", async () => {
    const host = controllableHost({ autoBusinessResult: { opened: false, messages: [], running: false } });
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => host.child,
    });

    await supervisor.start();
    await expect(supervisor.request("session.snapshot", {})).resolves.toEqual({ opened: false, messages: [], running: false });
    expect(host.received.map(({ type }) => type)).toEqual(["system.hello", "session.snapshot"]);
  });

  it("stops an incompatible host and keeps business commands blocked", async () => {
    const host = controllableHost({ handshake: { ...compatibleHandshake, piVersion: "0.85.0" } });
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => host.child,
    });

    await expect(supervisor.start()).rejects.toThrow("Incompatible Pi version: expected 0.84.2, received 0.85.0");
    expect(host.kill).toHaveBeenCalledOnce();
    await expect(supervisor.request("session.snapshot", {})).rejects.toThrow("Agent host handshake is not complete");
  });

  it("revokes readiness when the compatible host exits", async () => {
    const host = controllableHost();
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => host.child,
    });

    await supervisor.start();
    host.exit();

    await expect(supervisor.request("session.snapshot", {})).rejects.toThrow("Agent host handshake is not complete");
  });

  it("accepts the exact compatible runtime contract", () => {
    expect(validateHostHandshake(compatibleHandshake, "0.1.0")).toEqual(compatibleHandshake);
  });

  it("rejects an incompatible protocol before readiness", () => {
    expect(() => validateHostHandshake({ ...compatibleHandshake, protocolVersion: 2 }, "0.1.0"))
      .toThrow("Incompatible agent host protocol: expected 1, received 2");
  });

  it("rejects an incompatible host version before readiness", () => {
    expect(() => validateHostHandshake({ ...compatibleHandshake, hostVersion: "0.2.0" }, "0.1.0"))
      .toThrow("Incompatible agent host version: expected 0.1.0, received 0.2.0");
  });

  it("rejects a missing or incompatible exact Pi version before readiness", () => {
    const { piVersion: _missing, ...withoutPiVersion } = compatibleHandshake;
    expect(() => validateHostHandshake(withoutPiVersion, "0.1.0"))
      .toThrow("Invalid agent host handshake: missing piVersion");
    expect(() => validateHostHandshake({ ...compatibleHandshake, piVersion: "0.85.0" }, "0.1.0"))
      .toThrow("Incompatible Pi version: expected 0.84.2, received 0.85.0");
  });

  it.each(["sessionEvents", "modelSelection"] as const)("rejects missing required capability %s before readiness", (capability) => {
    expect(() => validateHostHandshake({
      ...compatibleHandshake,
      capabilities: { ...compatibleHandshake.capabilities, [capability]: false },
    }, "0.1.0")).toThrow(`Agent host is missing required capability: ${capability}`);
  });

  it("rejects every pending request before exit when a split success response is malformed", async () => {
    const host = controllableHost();
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => host.child,
    });
    const faults: unknown[] = [];
    supervisor.on("protocol.fault", (fault) => faults.push(fault));
    await supervisor.start();

    const snapshotRequest = supervisor.request("session.snapshot", {});
    const modelRequest = supervisor.request("model.list", {});
    const snapshotId = host.received.at(-2)!.requestId;
    const modelId = host.received.at(-1)!.requestId;
    host.write({ protocolVersion: 1, requestId: snapshotId, ok: true, result: { opened: false } }, [1, 2, 5, 3]);

    await expect(snapshotRequest).rejects.toThrow(`Agent host protocol fault for request ${snapshotId}`);
    await expect(modelRequest).rejects.toThrow(`Agent host protocol fault for request ${modelId}`);
    expect(faults).toEqual([{
      code: "INVALID_HOST_RECORD",
      message: `Agent host protocol fault for request ${snapshotId}`,
      requestId: snapshotId,
    }]);
    expect(host.kill).toHaveBeenCalledOnce();
    host.exit();
    expect(faults).toHaveLength(1);
  });

  it("rejects malformed error responses without exposing their content", async () => {
    const host = controllableHost();
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => host.child,
    });
    await supervisor.start();

    const request = supervisor.request("session.snapshot", {});
    const requestId = host.received.at(-1)!.requestId;
    host.write({
      protocolVersion: 1,
      requestId,
      ok: false,
      error: "sk-private-transcript-fragment",
      transcript: "private conversation",
    });

    await expect(request).rejects.toThrow(`Agent host protocol fault for request ${requestId}`);
  });

  it.each([
    { sequence: 1, payload: { type: "agent_start" } },
    { sequence: 0, payload: { type: "lifecycle", phase: "started" } },
  ])("faults on an invalid host event %#", async ({ sequence, payload }) => {
    const host = controllableHost();
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => host.child,
    });
    const fault = vi.fn();
    supervisor.on("protocol.fault", fault);
    await supervisor.start();

    host.write({ protocolVersion: 1, type: "session.event", sequence, payload });

    expect(fault).toHaveBeenCalledWith({
      code: "INVALID_HOST_RECORD",
      message: "Agent host protocol fault",
    });
    expect(host.kill).toHaveBeenCalledOnce();
  });

  it("does not copy an unsolicited request id into a protocol fault", async () => {
    const host = controllableHost();
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => host.child,
    });
    const fault = vi.fn();
    supervisor.on("protocol.fault", fault);
    await supervisor.start();

    host.write({
      protocolVersion: 1,
      requestId: "sk-private-transcript-fragment",
      ok: true,
      result: { opened: false, messages: [], running: false },
    });

    expect(fault).toHaveBeenCalledWith({
      code: "INVALID_HOST_RECORD",
      message: "Agent host protocol fault",
    });
  });

  it("does not classify a session event consumer failure as a protocol fault", async () => {
    const host = controllableHost();
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => host.child,
    });
    const fault = vi.fn();
    supervisor.on("protocol.fault", fault);
    supervisor.on("session.event", () => { throw new Error("consumer failed"); });
    await supervisor.start();

    expect(() => host.write({
      protocolVersion: 1,
      type: "session.event",
      sequence: 1,
      payload: { type: "lifecycle", phase: "started" },
    })).toThrow("consumer failed");
    expect(fault).not.toHaveBeenCalled();
    expect(host.kill).not.toHaveBeenCalled();
  });

  it("does not become ready when a valid hello and invalid record share a chunk", async () => {
    const host = controllableHost({
      helloRecords: (requestId) => [
        { protocolVersion: 1, requestId, ok: true, result: compatibleHandshake },
        { protocolVersion: 1, type: "session.event", sequence: 0, payload: { type: "lifecycle", phase: "started" } },
      ],
    });
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => host.child,
    });

    await expect(supervisor.start()).rejects.toThrow("Agent host stopped during handshake");
    await expect(supervisor.request("session.snapshot", {})).rejects.toThrow("Agent host handshake is not complete");
  });

  it("ignores stale output and exit callbacks after starting a replacement host", async () => {
    const first = controllableHost();
    const second = controllableHost();
    const hosts = [first.child, second.child];
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => hosts.shift()!,
    });
    const event = vi.fn();
    supervisor.on("session.event", event);
    await supervisor.start();
    first.write({ protocolVersion: 1, type: "session.event", sequence: 0, payload: { type: "lifecycle", phase: "started" } });
    await supervisor.start();

    first.write({ protocolVersion: 1, type: "session.event", sequence: 1, payload: { type: "lifecycle", phase: "started" } });
    first.exit();
    const request = supervisor.request("session.snapshot", {});
    const requestId = second.received.at(-1)!.requestId;
    second.write({ protocolVersion: 1, requestId, ok: true, result: { opened: false, messages: [], running: false } });

    expect(event).not.toHaveBeenCalled();
    await expect(request).resolves.toEqual({ opened: false, messages: [], running: false });
  });

  it("faults on an unsolicited valid error response", async () => {
    const host = controllableHost();
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => host.child,
    });
    const fault = vi.fn();
    supervisor.on("protocol.fault", fault);
    await supervisor.start();

    host.write({ protocolVersion: 1, requestId: "unsolicited", ok: false, error: "failed" });

    expect(fault).toHaveBeenCalledWith({ code: "INVALID_HOST_RECORD", message: "Agent host protocol fault" });
    expect(host.kill).toHaveBeenCalledOnce();
  });

  it("kills a malformed host even when a protocol fault observer throws", async () => {
    const host = controllableHost();
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => host.child,
    });
    supervisor.on("protocol.fault", () => { throw new Error("observer failed"); });
    await supervisor.start();

    expect(() => host.write({ protocolVersion: 1, type: "session.event", sequence: 0, payload: {} }))
      .toThrow("observer failed");
    expect(host.kill).toHaveBeenCalledOnce();
  });

  it("rejects pending requests and disconnects once when stopped", async () => {
    const host = controllableHost();
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => host.child,
    });
    const disconnected = vi.fn();
    supervisor.on("disconnected", disconnected);
    await supervisor.start();
    const request = supervisor.request("session.snapshot", {});

    supervisor.stop();

    await expect(request).rejects.toThrow("Agent host stopped");
    expect(disconnected).toHaveBeenCalledOnce();
    expect(host.kill).toHaveBeenCalledOnce();
    host.exit();
    expect(disconnected).toHaveBeenCalledOnce();
  });
});

function controllableHost(options: {
  handshake?: unknown;
  helloRecords?: (requestId: string) => unknown[];
  autoBusinessResult?: unknown;
} = {}): {
  child: ChildProcessWithoutNullStreams;
  kill: ReturnType<typeof vi.fn>;
  exit: () => void;
  received: Array<{ requestId: string; type: string }>;
  write: (record: unknown, chunkSizes?: number[]) => void;
} {
  const processEvents = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const kill = vi.fn(() => true);
  const received: Array<{ requestId: string; type: string }> = [];

  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string) => {
    for (const line of chunk.trim().split("\n")) {
      const request = JSON.parse(line) as { requestId: string; type: string };
      received.push(request);
      if (request.type === "system.hello") {
        const records = options.helloRecords?.(request.requestId)
          ?? [{ protocolVersion: 1, requestId: request.requestId, ok: true, result: options.handshake ?? compatibleHandshake }];
        stdout.write(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
      } else if ("autoBusinessResult" in options) {
        stdout.write(`${JSON.stringify({ protocolVersion: 1, requestId: request.requestId, ok: true, result: options.autoBusinessResult })}\n`);
      }
    }
  });

  return {
    child: Object.assign(processEvents, { stdin, stdout, stderr, kill }) as unknown as ChildProcessWithoutNullStreams,
    kill,
    exit: () => processEvents.emit("exit", 1, null),
    received,
    write: (record, chunkSizes = []) => {
      let encoded = `${JSON.stringify(record)}\n`;
      for (const size of chunkSizes) {
        stdout.write(encoded.slice(0, size));
        encoded = encoded.slice(size);
      }
      stdout.write(encoded);
    },
  };
}
