export const settingsSections = ["defaults", "providers", "user-skills", "appearance"] as const;

export type SettingsSection = (typeof settingsSections)[number];

export type ContentMode = { kind: "conversation" } | { kind: "workspace-skills"; workspacePath: string } | { kind: "settings"; section: SettingsSection };

export const conversationMode: ContentMode = { kind: "conversation" };

export const workspaceSkillsMode = (workspacePath: string): ContentMode => ({ kind: "workspace-skills", workspacePath });

export const settingsMode = (section: SettingsSection = "defaults"): ContentMode => ({ kind: "settings", section });

export function resolveContentMode(mode: ContentMode, workspacePath: string): ContentMode {
  if (mode.kind === "workspace-skills" && mode.workspacePath !== workspacePath) return conversationMode;
  return mode;
}
