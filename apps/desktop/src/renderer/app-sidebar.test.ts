import { describe, expect, it } from "vitest";
import { getWorkspaceDisclosureIntent } from "./src/app-sidebar.js";

describe("workspace disclosure keyboard behavior", () => {
  it("expands collapsed workspaces with ArrowRight", () => {
    expect(getWorkspaceDisclosureIntent("ArrowRight", false)).toBe("expand");
    expect(getWorkspaceDisclosureIntent("ArrowRight", true)).toBeUndefined();
  });

  it("collapses expanded workspaces with ArrowLeft or Escape", () => {
    expect(getWorkspaceDisclosureIntent("ArrowLeft", true)).toBe("collapse");
    expect(getWorkspaceDisclosureIntent("Escape", true)).toBe("collapse");
    expect(getWorkspaceDisclosureIntent("ArrowLeft", false)).toBeUndefined();
    expect(getWorkspaceDisclosureIntent("Escape", false)).toBeUndefined();
  });

  it("leaves ordinary button keys to native activation", () => {
    expect(getWorkspaceDisclosureIntent("Enter", false)).toBeUndefined();
    expect(getWorkspaceDisclosureIntent(" ", true)).toBeUndefined();
  });
});
