import { describe, expect, it } from "vitest";
import { AppCatalog } from "./app-catalog.js";

describe("AppCatalog", () => {
  it("deduplicates and removes workspaces", async () => {
    let stored = "";
    const catalog = new AppCatalog({
      read: async () => stored,
      write: async (value) => {
        stored = value;
      },
    });
    await catalog.addWorkspace("/tmp/a");
    await catalog.addWorkspace("/tmp/a");
    expect(catalog.snapshot()).toEqual({ workspaces: [{ path: "/tmp/a", name: "a" }] });
    await catalog.removeWorkspace("/tmp/a");
    expect(JSON.parse(stored).workspaces).toEqual([]);
  });
});
