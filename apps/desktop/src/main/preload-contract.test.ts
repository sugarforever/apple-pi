import { afterEach, describe, expect, it, vi } from "vitest";

// Every other namespace on `window.applePi` (session, model, provider) is
// exercised indirectly through the renderer, but nothing in this repo yet
// unit-tests the preload script's own API shape. These tests mock `electron`
// so the preload module (a side-effecting `contextBridge.exposeInMainWorld`
// call at import time) can be loaded under vitest, and assert on the exact
// object it hands to the renderer — catching a missing/malformed `skill`
// namespace before it ever reaches a real window.
describe("applePi preload API contract", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("electron");
  });

  async function loadExposedApi(invoke: (...args: unknown[]) => unknown = vi.fn()): Promise<Record<string, any>> {
    let exposed: Record<string, unknown> | undefined;
    vi.doMock("electron", () => ({
      contextBridge: {
        exposeInMainWorld: (_key: string, api: Record<string, unknown>) => {
          exposed = api;
        },
      },
      ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn() },
    }));
    await import("../preload/index.js");
    if (!exposed) throw new Error("contextBridge.exposeInMainWorld was not called");
    return exposed as Record<string, any>;
  }

  it("exposes a skill namespace with list/listDisabled/install/setEnabled/remove", async () => {
    const api = await loadExposedApi();
    expect(typeof api.skill).toBe("object");
    expect(typeof api.skill.list).toBe("function");
    expect(typeof api.skill.listDisabled).toBe("function");
    expect(typeof api.skill.install).toBe("function");
    expect(typeof api.skill.setEnabled).toBe("function");
    expect(typeof api.skill.remove).toBe("function");
    // Arity documents the call shape renderer code will use, matching
    // `install(scope, sourcePath)`, `setEnabled(name, scope, enabled)`, `remove(name, scope)`.
    expect(api.skill.install).toHaveLength(2);
    expect(api.skill.list).toHaveLength(1);
    expect(api.skill.listDisabled).toHaveLength(1);
    expect(api.skill.setEnabled).toHaveLength(3);
    expect(api.skill.remove).toHaveLength(2);
  });

  it("routes skill methods through plain ipcRenderer.invoke calls, not invokeOperation", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    const api = await loadExposedApi(invoke);

    await api.skill.list(["user"]);
    expect(invoke).toHaveBeenLastCalledWith("skill:list", ["user"]);

    await api.skill.listDisabled(["project"]);
    expect(invoke).toHaveBeenLastCalledWith("skill:listDisabled", ["project"]);

    await api.skill.install("project", "/tmp/my-skill");
    expect(invoke).toHaveBeenLastCalledWith("skill:install", { scope: "project", sourcePath: "/tmp/my-skill" });

    await api.skill.setEnabled("my-skill", "user", false);
    expect(invoke).toHaveBeenLastCalledWith("skill:setEnabled", { name: "my-skill", scope: "user", enabled: false });

    await api.skill.remove("my-skill", "project");
    expect(invoke).toHaveBeenLastCalledWith("skill:remove", { name: "my-skill", scope: "project" });

    // Unlike `provider.*` mutation methods, no operationId/timeoutMs is ever
    // synthesized for skill commands: the protocol payloads for skill.install /
    // setEnabled / remove carry no such fields, so `invoke` is called with
    // exactly the arguments above and nothing more.
    for (const call of invoke.mock.calls) {
      const payload = call[1];
      if (payload && typeof payload === "object") {
        expect(payload).not.toHaveProperty("operationId");
        expect(payload).not.toHaveProperty("timeoutMs");
      }
    }
  });
});
