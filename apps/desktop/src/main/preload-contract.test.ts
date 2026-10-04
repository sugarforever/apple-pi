import { afterEach, describe, expect, it, vi } from "vitest";

// The preload is a side-effecting `contextBridge.exposeInMainWorld` call, so
// these tests mock `electron` and assert on the exact object the renderer gets.
describe("applePi preload API contract", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("electron");
  });

  async function loadExposedApi(
    invoke: (...args: unknown[]) => unknown = vi.fn(),
    listeners = { on: vi.fn(), removeListener: vi.fn() },
  ): Promise<Record<string, any>> {
    let exposed: Record<string, unknown> | undefined;
    vi.doMock("electron", () => ({
      contextBridge: {
        exposeInMainWorld: (_key: string, api: Record<string, unknown>) => {
          exposed = api;
        },
      },
      ipcRenderer: { invoke, ...listeners },
    }));
    await import("../preload/index.js");
    if (!exposed) throw new Error("contextBridge.exposeInMainWorld was not called");
    return exposed as Record<string, any>;
  }

  it("exposes exactly the narrow Pi namespaces and routes each call to its channel", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = await loadExposedApi(invoke);

    expect(Object.keys(api).sort()).toEqual(["app", "pi", "sessions", "shell", "workspaces"]);
    const surface = Object.fromEntries(["workspaces", "sessions", "pi", "shell", "app"].map((name) => [name, Object.keys(api[name]).sort()]));
    expect(surface).toEqual({
      workspaces: ["list", "pick", "remove"],
      sessions: ["list"],
      pi: ["close", "onEvent", "open", "respondUI", "send"],
      shell: ["openSettingsFile", "openTerminal"],
      app: ["onCommand"],
    });

    const command = { type: "prompt", message: "hi" };
    const response = { type: "extension_ui_response", id: "ui-1", confirmed: true };
    await api.workspaces.pick();
    await api.workspaces.list();
    await api.workspaces.remove("/w");
    await api.sessions.list("/w");
    await api.pi.open({ workspace: "/w" });
    await api.pi.send("key", command);
    await api.pi.respondUI("key", response);
    await api.pi.close("key");
    await api.shell.openSettingsFile();
    await api.shell.openTerminal("/w");
    expect(invoke.mock.calls).toEqual([
      ["workspaces:pick"],
      ["workspaces:list"],
      ["workspaces:remove", "/w"],
      ["sessions:list", "/w"],
      ["pi:open", { workspace: "/w" }],
      ["pi:send", "key", command],
      ["pi:respondUI", "key", response],
      ["pi:close", "key"],
      ["shell:openSettingsFile"],
      ["shell:openTerminal", "/w"],
    ]);
  });

  it("delivers pi:event messages to subscribers until they unsubscribe", async () => {
    const on = vi.fn();
    const removeListener = vi.fn();
    const api = await loadExposedApi(vi.fn(), { on, removeListener });

    const listener = vi.fn();
    const unsubscribe = api.pi.onEvent(listener);
    const [channel, handler] = on.mock.calls[0]!;
    expect(channel).toBe("pi:event");
    handler({}, { sessionKey: "key", event: { type: "agent_start" } });
    expect(listener).toHaveBeenCalledWith({ sessionKey: "key", event: { type: "agent_start" } });
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith("pi:event", handler);
  });

  it("delivers app:command menu commands to subscribers until they unsubscribe", async () => {
    const on = vi.fn();
    const removeListener = vi.fn();
    const api = await loadExposedApi(vi.fn(), { on, removeListener });

    const listener = vi.fn();
    const unsubscribe = api.app.onCommand(listener);
    const [channel, handler] = on.mock.calls[0]!;
    expect(channel).toBe("app:command");
    handler({}, "new-chat");
    expect(listener).toHaveBeenCalledWith("new-chat");
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith("app:command", handler);
  });
});
