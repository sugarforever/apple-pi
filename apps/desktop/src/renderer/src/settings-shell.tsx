import React from "react";
import type { ModelItem, ModelRef } from "../global.js";
import { ModelSelect, modelKey } from "./model-select.js";
import { ProviderSettings, type ProviderSettingsProps } from "./provider-settings.js";
import { SkillSettings, type SkillSettingsProps } from "./skill-settings.js";
import { Notice, SectionHeading } from "./ui-primitives.js";
import type { SettingsSection } from "../content-mode.js";

const settingsNavigation: ReadonlyArray<{ id: Exclude<SettingsSection, "appearance">; label: string }> = [
  { id: "defaults", label: "Defaults" },
  { id: "providers", label: "Providers" },
  { id: "user-skills", label: "User Skills" },
];

export interface SettingsShellProps {
  section: SettingsSection;
  onSectionChange(section: SettingsSection): void;
  models: ModelItem[];
  groupedModels: Map<string, ModelItem[]>;
  defaultModel?: ModelRef;
  onDefaultModel(value: string): void;
  providerSettings: ProviderSettingsProps;
  skillSettings: SkillSettingsProps;
}

export function SettingsShell(props: SettingsShellProps) {
  return (
    <section className="settings">
      <div className="settings-intro">
        <h1>Make Apple Pi Yours</h1>
        <p>Choose how new sessions begin. Changes are saved automatically.</p>
      </div>
      <div className="settings-layout">
        <nav className="settings-sections" aria-label="Settings sections">
          {settingsNavigation.map((section) => (
            <button key={section.id} aria-current={props.section === section.id ? "page" : undefined} onClick={() => props.onSectionChange(section.id)}>
              {section.label}
            </button>
          ))}
        </nav>
        <div className="settings-section-content">
          {props.section === "defaults" && (
            <div className="settings-card">
              <SectionHeading
                id="default-model-title"
                title="Default Model"
                description="Used when you create a workspace or begin a new session. You can still switch models from the composer."
              />
              {props.models.length === 0 ? (
                <Notice className="model-empty">
                  <strong>No usable models yet.</strong>
                  <span>
                    <button className="settings-inline-link" onClick={() => props.onSectionChange("providers")}>
                      Connect a provider
                    </button>{" "}
                    to choose a default model.
                  </span>
                </Notice>
              ) : (
                <div className="settings-control">
                  <label htmlFor="default-model">Model</label>
                  <ModelSelect
                    id="default-model"
                    models={props.groupedModels}
                    value={props.defaultModel ? modelKey(props.defaultModel) : ""}
                    onChange={props.onDefaultModel}
                    emptyLabel="Use pi default"
                  />
                </div>
              )}
            </div>
          )}
          {props.section === "providers" && <ProviderSettings {...props.providerSettings} />}
          {props.section === "user-skills" && <SkillSettings {...props.skillSettings} />}
          {props.section === "appearance" && (
            <Notice>
              <strong>Appearance follows your system.</strong>
              <span>More appearance controls can be added here without changing the Settings navigation contract.</span>
            </Notice>
          )}
        </div>
      </div>
    </section>
  );
}
