import React from "react";
import type { ModelItem, ModelRef } from "../global.js";
import { ModelSelect, modelKey } from "./model-select.js";
import { ProviderSettings, type ProviderSettingsProps } from "./provider-settings.js";
import { SkillSettings, type SkillSettingsProps } from "./skill-settings.js";
import { Notice, SectionHeading } from "./ui-primitives.js";

export interface SettingsShellProps {
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
              <a href="#providers-title">Connect a provider</a> to choose a default model.
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
      <ProviderSettings {...props.providerSettings} />
      <SkillSettings {...props.skillSettings} />
    </section>
  );
}
