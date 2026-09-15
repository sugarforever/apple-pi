import { describe, expect, it } from "vitest";
import { AppCatalog } from "./app-catalog.js";

describe("AppCatalog", () => {
  it("deduplicates workspaces and persists the default model", async () => {
    let stored = "";
    const catalog = new AppCatalog({ read: async () => stored, write: async (value) => { stored = value; } });
    await catalog.addWorkspace("/tmp/a");
    await catalog.addWorkspace("/tmp/a");
    await catalog.setDefaultModel({ provider: "openai", modelId: "gpt-5" });
    expect(catalog.snapshot()).toMatchObject({ workspaces: [{ path: "/tmp/a", name: "a" }], defaultModel: { provider: "openai", modelId: "gpt-5" } });
    await catalog.clearDefaultModel();
    expect(catalog.snapshot().defaultModel).toBeUndefined();
  });
});
