import { describe, expect, it } from "vitest";
import {
  conversationMode,
  resolveContentMode,
  settingsMode,
  settingsSections,
  workspaceSkillsMode,
  type ContentMode,
  type SettingsSection,
} from "./content-mode.js";

describe("renderer content modes", () => {
  it("represents conversation, workspace skills, and settings as distinct typed modes", () => {
    const modes: ContentMode[] = [conversationMode, workspaceSkillsMode("/work/apple-pi"), settingsMode("providers")];

    expect(modes).toEqual([
      { kind: "conversation" },
      { kind: "workspace-skills", workspacePath: "/work/apple-pi" },
      { kind: "settings", section: "providers" },
    ]);
  });

  it("defines current settings sections while reserving appearance as a typed expansion point", () => {
    const expected: readonly SettingsSection[] = ["defaults", "providers", "user-skills", "appearance"];

    expect(settingsSections).toEqual(expected);
  });

  it("falls back to conversation when workspace-owned skills no longer match the active workspace", () => {
    const mode = workspaceSkillsMode("/work/old");

    expect(resolveContentMode(mode, "/work/new")).toEqual(conversationMode);
    expect(resolveContentMode(mode, "")).toEqual(conversationMode);
  });

  it("preserves workspace skills for their owner and global settings across workspace changes", () => {
    const skills = workspaceSkillsMode("/work/apple-pi");
    const settings = settingsMode("user-skills");

    expect(resolveContentMode(skills, "/work/apple-pi")).toBe(skills);
    expect(resolveContentMode(settings, "/work/other")).toBe(settings);
  });
});
