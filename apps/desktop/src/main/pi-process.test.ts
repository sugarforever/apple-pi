import { once } from "node:events";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PiProcess, PiProcessPool, type PiProcessEvent, type PiProcessExit, type PiProcessOptions } from "./pi-process.js";

const fakeChild: PiProcessOptions = {
  workspace: tmpdir(),
  entryPath: fileURLToPath(new URL("./fixtures/fake-rpc-child.mjs", import.meta.url)),
};

const started: PiProcess[] = [];
function startFake(options: Partial<PiProcessOptions> = {}): PiProcess {
  const piProcess = new PiProcess({ ...fakeChild, ...options });
  piProcess.start();
  started.push(piProcess);
  return piProcess;
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((piProcess) => piProcess.stop()));
});

describe("PiProcess", () => {
  it("matches responses to commands by id", async () => {
    const pi = startFake();
    const slow = pi.send({ type: "get_state" });
    const fast = pi.send({ type: "get_messages" });

    await expect(fast).resolves.toMatchObject({ command: "get_messages", success: true });
    await expect(slow).resolves.toMatchObject({ command: "get_state", data: { sessionId: "fake" } });
  });

  it("rejects a command Pi never answers", async () => {
    const pi = startFake({ requestTimeoutMs: 100 });

    await expect(pi.send({ type: "abort" })).rejects.toThrow("Pi did not answer abort within 100ms");
    expect(pi.idle).toBe(true);
  });

  it("skips malformed lines and reassembles split ones", async () => {
    const pi = startFake();

    await expect(pi.send({ type: "get_commands" })).resolves.toMatchObject({ command: "get_commands", success: true });
  });

  it("rejects pending commands and reports the exit when Pi crashes", async () => {
    const pi = startFake();
    const exit = once(pi, "exit") as Promise<[PiProcessExit]>;
    const pending = pi.send({ type: "abort" });
    void pi.send({ type: "bash", command: "true" }).catch(() => undefined);

    await expect(pending).rejects.toThrow("Pi process exited (code 3");
    const [{ code, stderr }] = await exit;
    expect(code).toBe(3);
    expect(stderr).toContain("fake pi crashed");
  });
});

describe("PiProcessPool", () => {
  it("stops the least recently used idle process when full", async () => {
    const pool = new PiProcessPool({ cap: 2 });
    const busy = pool.open("busy", fakeChild);
    const idle = pool.open("idle", fakeChild);
    const agentStarted = once(busy, "event") as Promise<[PiProcessEvent]>;
    await busy.send({ type: "prompt", message: "hi" });
    expect((await agentStarted)[0].type).toBe("agent_start");

    const idleExit = once(idle, "exit");
    pool.open("new", fakeChild);
    await idleExit;

    expect(pool.get("idle")).toBeUndefined();
    expect(pool.get("busy")).toBe(busy);
    await pool.stopAll();
    expect(pool.get("busy")).toBeUndefined();
  });
});
