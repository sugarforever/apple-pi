import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import type { AppCatalog } from "./app-catalog.js";
import { registerPiIpc, type PiIpcOptions } from "./pi-ipc.js";
import type { PiProcessPool } from "./pi-process.js";

vi.mock("electron", () => ({ dialog: {}, shell: {} }));

const env = { PATH: "/from/login/shell" };

it("opens only known workspaces, gives one file one process, and passes Pi traffic through unchanged", async () => {
  const handlers = new Map<string, Parameters<PiIpcOptions["handle"]>[1]>();
  const toRenderer = vi.fn();
  const piProcess = Object.assign(new EventEmitter(), { send: vi.fn().mockResolvedValue({ type: "response", success: true }) });
  const live = new Map<string, typeof piProcess>();
  const pool = { open: vi.fn((key: string) => (live.set(key, piProcess), piProcess)), get: (key: string) => live.get(key) };
  registerPiIpc({
    handle: (channel, handler) => handlers.set(channel, handler),
    getWindow: () => ({ webContents: { send: toRenderer } }) as never,
    catalog: { snapshot: () => ({ workspaces: [{ path: "/w", name: "w" }] }) } as unknown as AppCatalog,
    pool: pool as unknown as PiProcessPool,
    spawnEnv: async () => env,
  });
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({} as never, ...args);

  await expect(call("pi:open", { workspace: "/elsewhere" })).rejects.toThrow("Unknown workspace");
  const [sessionKey, again] = await Promise.all([
    call("pi:open", { workspace: "/w", sessionFile: "/s/a.jsonl" }),
    call("pi:open", { workspace: "/w", sessionFile: "/s/a.jsonl" }),
  ]);
  expect(again).toBe(sessionKey);
  expect(pool.open).toHaveBeenCalledExactlyOnceWith(sessionKey, { workspace: "/w", sessionFile: "/s/a.jsonl", env });

  const prompt = { type: "prompt", message: "hi" };
  await call("pi:send", sessionKey, prompt);
  expect(piProcess.send).toHaveBeenLastCalledWith(prompt, undefined);
  await call("pi:send", sessionKey, { type: "compact" });
  expect(piProcess.send.mock.lastCall?.[1]).toBeGreaterThan(30_000);
  await expect(call("pi:send", "missing", prompt)).rejects.toThrow("Pi session is not open");

  piProcess.emit("event", { type: "agent_start" });
  piProcess.emit("exit", { code: 0, signal: null, stderr: "" });
  expect(toRenderer.mock.calls).toEqual([
    ["pi:event", { sessionKey, event: { type: "agent_start" } }],
    ["pi:event", { sessionKey, exited: { code: 0, signal: null, stderr: "" } }],
  ]);
});

it("routes a reopened session file to the live new-session process Pi reported it for", async () => {
  const handlers = new Map<string, Parameters<PiIpcOptions["handle"]>[1]>();
  const live = new Map<string, EventEmitter & { send: ReturnType<typeof vi.fn> }>();
  const pool = {
    open: vi.fn((key: string) => {
      const piProcess = Object.assign(new EventEmitter(), {
        send: vi.fn().mockResolvedValue({ type: "response", command: "get_state", success: true, data: { sessionFile: "/s/new.jsonl" } }),
      });
      live.set(key, piProcess);
      return piProcess;
    }),
    get: (key: string) => live.get(key),
  };
  registerPiIpc({
    handle: (channel, handler) => handlers.set(channel, handler),
    getWindow: () => undefined,
    catalog: { snapshot: () => ({ workspaces: [{ path: "/w", name: "w" }] }) } as unknown as AppCatalog,
    pool: pool as unknown as PiProcessPool,
    spawnEnv: async () => env,
  });
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({} as never, ...args);

  const fresh = (await call("pi:open", { workspace: "/w" })) as string;
  expect(await call("pi:open", { workspace: "/w", sessionFile: "/s/new.jsonl" })).not.toBe(fresh);
  live.delete("/s/new.jsonl");
  pool.open.mockClear();

  await call("pi:send", fresh, { type: "get_state" });
  expect(await call("pi:open", { workspace: "/w", sessionFile: "/s/new.jsonl" })).toBe(fresh);
  expect(pool.open).not.toHaveBeenCalled();

  live.get(fresh)!.emit("exit", { code: 0, signal: null, stderr: "" });
  live.delete(fresh);
  pool.open.mockClear();
  expect(await call("pi:open", { workspace: "/w", sessionFile: "/s/new.jsonl" })).not.toBe(fresh);
  expect(pool.open).toHaveBeenCalledOnce();
});

it("follows a process to the file a fork moves it to", async () => {
  const handlers = new Map<string, Parameters<PiIpcOptions["handle"]>[1]>();
  const live = new Map<string, EventEmitter & { send: ReturnType<typeof vi.fn> }>();
  const pool = {
    open: vi.fn((key: string) => {
      const piProcess = Object.assign(new EventEmitter(), {
        send: vi.fn(async ({ type }: { type: string }) =>
          type === "get_state"
            ? { type: "response", command: "get_state", success: true, data: { sessionFile: "/s/child.jsonl" } }
            : { type: "response", command: type, success: true, data: { cancelled: false } },
        ),
      });
      live.set(key, piProcess);
      return piProcess;
    }),
    get: (key: string) => live.get(key),
  };
  registerPiIpc({
    handle: (channel, handler) => handlers.set(channel, handler),
    getWindow: () => undefined,
    catalog: { snapshot: () => ({ workspaces: [{ path: "/w", name: "w" }] }) } as unknown as AppCatalog,
    pool: pool as unknown as PiProcessPool,
    spawnEnv: async () => env,
  });
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({} as never, ...args);

  const parent = (await call("pi:open", { workspace: "/w", sessionFile: "/s/parent.jsonl" })) as string;
  await call("pi:send", parent, { type: "fork", entryId: "e1" });
  expect(live.get(parent)!.send).toHaveBeenLastCalledWith({ type: "get_state" });
  expect(await call("pi:open", { workspace: "/w", sessionFile: "/s/child.jsonl" })).toBe(parent);
  expect(await call("pi:open", { workspace: "/w", sessionFile: "/s/parent.jsonl" })).not.toBe(parent);
  expect(pool.open).toHaveBeenCalledTimes(2);
});
