import React from "react";
import type { SettingsSection } from "../../content-mode.js";

const settingsNavigation: ReadonlyArray<{ id: Exclude<SettingsSection, "appearance">; label: string }> = [
  { id: "defaults", label: "Defaults" },
  { id: "providers", label: "Providers" },
  { id: "user-skills", label: "User Skills" },
];

export interface SettingsNavigationProps {
  section: SettingsSection;
  onSectionChange(section: SettingsSection): void;
}

export function SettingsNavigation({ section, onSectionChange }: SettingsNavigationProps) {
  return (
    <nav className="settings-sections" aria-label="Settings sections">
      {settingsNavigation.map((item) => (
        <button key={item.id} aria-current={section === item.id ? "page" : undefined} onClick={() => onSectionChange(item.id)}>
          {item.label}
        </button>
      ))}
    </nav>
  );
}
