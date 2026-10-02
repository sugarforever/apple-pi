import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import type { AppCatalog } from "./app-catalog.js";
import { registerPiIpc, type PiIpcOptions } from "./pi-ipc.js";
import type { PiProcessPool } from "./pi-process.js";

vi.mock("electron", () => ({ dialog: {}, shell: {} }));

it("opens only known workspaces, keys resumed sessions by file, and passes Pi traffic through unchanged", async () => {
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
  });
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({} as never, ...args);

  expect(() => call("pi:open", { workspace: "/elsewhere" })).toThrow("Unknown workspace");
  const sessionKey = call("pi:open", { workspace: "/w", sessionFile: "/s/a.jsonl" });
  expect(call("pi:open", { workspace: "/w", sessionFile: "/s/a.jsonl" })).toBe(sessionKey);
  expect(pool.open).toHaveBeenCalledExactlyOnceWith(sessionKey, { workspace: "/w", sessionFile: "/s/a.jsonl" });

  const prompt = { type: "prompt", message: "hi" };
  await call("pi:send", sessionKey, prompt);
  expect(piProcess.send).toHaveBeenLastCalledWith(prompt, undefined);
  await call("pi:send", sessionKey, { type: "compact" });
  expect(piProcess.send.mock.lastCall?.[1]).toBeGreaterThan(30_000);
  expect(() => call("pi:send", "missing", prompt)).toThrow("Pi session is not open");

  piProcess.emit("event", { type: "agent_start" });
  piProcess.emit("exit", { code: 0, signal: null, stderr: "" });
  expect(toRenderer.mock.calls).toEqual([
    ["pi:event", { sessionKey, event: { type: "agent_start" } }],
    ["pi:event", { sessionKey, exited: { code: 0, signal: null, stderr: "" } }],
  ]);
});
