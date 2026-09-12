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
    const { child, received } = fakeHost(compatibleHandshake);
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => child,
    });

    await supervisor.start();
    await expect(supervisor.request("session.snapshot", {})).resolves.toEqual({ opened: false });
    expect(received).toEqual(["system.hello", "session.snapshot"]);
  });

  it("stops an incompatible host and keeps business commands blocked", async () => {
    const { child, kill } = fakeHost({ ...compatibleHandshake, piVersion: "0.85.0" });
    const supervisor = new AgentHostSupervisor({
      hostPath: () => "/fake/agent-host.js",
      hostVersion: () => "0.1.0",
      spawnHost: () => child,
    });

    await expect(supervisor.start()).rejects.toThrow("Incompatible Pi version: expected 0.84.2, received 0.85.0");
    expect(kill).toHaveBeenCalledOnce();
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
});

function fakeHost(handshake: unknown): {
  child: ChildProcessWithoutNullStreams;
  kill: ReturnType<typeof vi.fn>;
  received: string[];
} {
  const processEvents = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const kill = vi.fn(() => true);
  const received: string[] = [];

  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string) => {
    for (const line of chunk.trim().split("\n")) {
      const request = JSON.parse(line) as { requestId: string; type: string };
      received.push(request.type);
      const result = request.type === "system.hello" ? handshake : { opened: false };
      stdout.write(`${JSON.stringify({ protocolVersion: 1, requestId: request.requestId, ok: true, result })}\n`);
    }
  });

  return {
    child: Object.assign(processEvents, { stdin, stdout, stderr, kill }) as unknown as ChildProcessWithoutNullStreams,
    kill,
    received,
  };
}
