import React, { useMemo, useState } from "react";
import { AlertCircle, FolderOpen, Plus, Search, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import type { SkillDiagnostic, SkillItem, SkillOperationResult, SkillScope } from "@apple-pi/protocol";

export type SkillActivity = "idle" | "checking";

export interface SkillSettingsProps {
  skills: SkillItem[];
  diagnostics: SkillDiagnostic[];
  // A project-scoped skill only makes sense while a workspace is open; the
  // parent (main.tsx) is the one that knows whether that is currently true.
  canInstallToProject: boolean;
  onInstall(scope: SkillScope, sourcePath: string): Promise<SkillOperationResult>;
  onSetEnabled(name: string, scope: SkillScope, enabled: boolean): Promise<SkillOperationResult>;
  onRemove(name: string, scope: SkillScope): Promise<SkillOperationResult>;
  onPickDirectory(): Promise<string | null>;
}

// Skills are identified by scope+name together: the same name can exist once
// per scope (e.g. a "user" and a "project" skill both named "release-notes"),
// so `name` alone cannot key activity/feedback state or a React list.
export function skillKey(scope: SkillScope, name: string): string {
  return `${scope}:${name}`;
}

// A skill is "enabled" exactly when Pi's own `disableModelInvocation` flag is
// false; the UI only ever shows this derived, human-facing state.
export function isSkillEnabled(skill: SkillItem): boolean {
  return !skill.disableModelInvocation;
}

// `SkillDiagnostic` has no `severity` field (unlike `ProviderDiagnostic`) --
// only a `type` of "warning" | "error" | "collision". Both "error" and
// "collision" are alarming/actionable enough to announce as an alert; a plain
// "warning" is informational and uses the quieter `status` role instead.
export function diagnosticRole(type: SkillDiagnostic["type"]): "alert" | "status" {
  return type === "warning" ? "status" : "alert";
}

// Mirrors `firstActionableDiagnostic` in provider-settings.tsx, adapted to
// `SkillDiagnostic`'s `type` field: prefers an error/collision over a mere
// warning, but still surfaces a warning when that is all there is.
export function firstActionableSkillDiagnostic(result: SkillOperationResult): SkillDiagnostic | undefined {
  return result.diagnostics.find((item) => item.type !== "warning") ?? result.diagnostics[0];
}

// A skill with `managed: false` came from a settings.json entry or a bundled
// extension: Apple Pi did not install it and `setEnabled`/`remove` on it will
// always come back rejected (see `notManagedDiagnostic` in
// `@apple-pi/pi-adapter`'s skill-service.ts). Controls are disabled up front
// with this explanation instead of letting the user trigger a call that is
// already known to fail.
const NOT_MANAGED_TITLE = "Apple Pi doesn't manage this skill (it came from a settings.json entry or a bundled extension), so it can't be changed here.";

export function SkillSettings(props: SkillSettingsProps) {
  const [query, setQuery] = useState("");
  const [activity, setActivity] = useState<Record<string, SkillActivity>>({});
  const [feedback, setFeedback] = useState<Record<string, SkillDiagnostic | undefined>>({});
  // Two-step "arm, then confirm" pattern for Remove: the first click swaps
  // the button for an inline "Remove ‘x’? Yes / Cancel" prompt (role="status"
  // announces the swap to assistive tech) rather than firing the destructive
  // call immediately or opening a separate dialog.
  const [confirmingRemove, setConfirmingRemove] = useState<Record<string, boolean>>({});
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [installScope, setInstallScope] = useState<SkillScope>("user");
  const [installBusy, setInstallBusy] = useState(false);
  const [installFeedback, setInstallFeedback] = useState<SkillDiagnostic | undefined>(undefined);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? props.skills.filter((skill) => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(needle)) : props.skills;
  }, [props.skills, query]);

  const run = async (key: string, operation: () => Promise<SkillOperationResult>): Promise<void> => {
    setActivity((current) => ({ ...current, [key]: "checking" }));
    setFeedback((current) => ({ ...current, [key]: undefined }));
    try {
      const result = await operation();
      setFeedback((current) => ({ ...current, [key]: firstActionableSkillDiagnostic(result) }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [key]: { type: "error", message: error instanceof Error ? error.message : "Apple Pi could not complete this skill operation. Try again." },
      }));
    } finally {
      setActivity((current) => ({ ...current, [key]: "idle" }));
    }
  };

  const toggleEnabled = (skill: SkillItem): void => {
    void run(skillKey(skill.scope, skill.name), () => props.onSetEnabled(skill.name, skill.scope, !isSkillEnabled(skill)));
  };

  const removeSkill = (skill: SkillItem): void => {
    const key = skillKey(skill.scope, skill.name);
    setConfirmingRemove((current) => ({ ...current, [key]: false }));
    void run(key, () => props.onRemove(skill.name, skill.scope));
  };

  const pickDirectory = async (): Promise<void> => {
    const path = await props.onPickDirectory();
    if (!path) return;
    setPickedPath(path);
    setInstallFeedback(undefined);
    setInstallScope(props.canInstallToProject ? installScope : "user");
  };

  const submitInstall = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!pickedPath) return;
    setInstallBusy(true);
    setInstallFeedback(undefined);
    try {
      const result = await props.onInstall(installScope, pickedPath);
      const diagnostic = firstActionableSkillDiagnostic(result);
      setInstallFeedback(diagnostic);
      if (!diagnostic || diagnostic.type === "warning") setPickedPath(null);
    } catch (error) {
      setInstallFeedback({ type: "error", message: error instanceof Error ? error.message : "Apple Pi could not install this skill. Try again." });
    } finally {
      setInstallBusy(false);
    }
  };

  return (
    <section className="skill-settings" aria-labelledby="skills-title">
      <div className="skill-heading">
        <div>
          <h2 id="skills-title">Skills</h2>
          <p>Extend Apple Pi with reusable skills the model can invoke, installed per user or per project.</p>
        </div>
        <label className="skill-search">
          <span className="sr-only">Search skills</span>
          <Search size={15} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills" />
        </label>
      </div>
      {props.diagnostics.map((diagnostic, index) => (
        <p key={`catalog-diagnostic-${index}`} className={`skill-diagnostic ${diagnostic.type}`} role={diagnosticRole(diagnostic.type)}>
          {diagnostic.message}
        </p>
      ))}
      <div className="skill-install">
        <button type="button" aria-label="Install skill" onClick={() => void pickDirectory()} disabled={installBusy}>
          <Plus size={14} /> Install skill
        </button>
        {pickedPath && (
          <form className="skill-install-form" aria-label="Install skill" onSubmit={(event) => void submitInstall(event)} aria-busy={installBusy}>
            <p className="skill-install-path">
              <FolderOpen size={13} aria-hidden="true" /> {pickedPath}
            </p>
            <fieldset disabled={installBusy}>
              <legend>Install to</legend>
              <label className="radio-field">
                <input type="radio" name="skill-install-scope" value="user" checked={installScope === "user"} onChange={() => setInstallScope("user")} />
                <span>This user (all workspaces)</span>
              </label>
              {props.canInstallToProject && (
                <label className="radio-field">
                  <input
                    type="radio"
                    name="skill-install-scope"
                    value="project"
                    checked={installScope === "project"}
                    onChange={() => setInstallScope("project")}
                  />
                  <span>This project only</span>
                </label>
              )}
            </fieldset>
            <div className="skill-install-actions">
              <button type="submit" disabled={installBusy}>
                {installBusy ? "Installing…" : "Add skill"}
              </button>
              <button type="button" className="secondary" onClick={() => setPickedPath(null)} disabled={installBusy}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {installFeedback && (
          <p className={`skill-diagnostic ${installFeedback.type}`} role={diagnosticRole(installFeedback.type)}>
            {installFeedback.message}
          </p>
        )}
      </div>
      {props.skills.length === 0 ? (
        <div className="skill-empty">
          <AlertCircle size={22} />
          <strong>No skills installed</strong>
          <p>Install a skill directory to make it available to the model.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="skill-empty">
          <strong>No matching skills</strong>
          <p>Try a different search term.</p>
        </div>
      ) : (
        <div className="skill-list">
          {visible.map((skill) => {
            const key = skillKey(skill.scope, skill.name);
            const checking = activity[key] === "checking";
            const enabled = isSkillEnabled(skill);
            const diagnostic = feedback[key];
            const confirming = confirmingRemove[key] ?? false;
            return (
              <article className="skill-card" key={key} aria-busy={checking}>
                <div className="skill-summary">
                  <div className="skill-name">
                    <h3>{skill.name}</h3>
                    <p>
                      {skill.scope} · {skill.managed ? "Apple Pi managed" : "Not managed by Apple Pi"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="skill-toggle"
                    aria-label={enabled ? `Disable ${skill.name}` : `Enable ${skill.name}`}
                    aria-pressed={enabled}
                    onClick={() => toggleEnabled(skill)}
                    disabled={checking || !skill.managed}
                    title={!skill.managed ? NOT_MANAGED_TITLE : undefined}
                  >
                    {enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    {enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
                <p className="skill-description">{skill.description}</p>
                <p className="skill-path">{skill.path}</p>
                {diagnostic && (
                  <p className={`skill-diagnostic ${diagnostic.type}`} role={diagnosticRole(diagnostic.type)}>
                    {diagnostic.message}
                  </p>
                )}
                <div className="skill-actions">
                  {!confirming ? (
                    <button
                      type="button"
                      className="danger-button"
                      aria-label={`Remove ${skill.name}`}
                      onClick={() => setConfirmingRemove((current) => ({ ...current, [key]: true }))}
                      disabled={checking || !skill.managed}
                      title={!skill.managed ? NOT_MANAGED_TITLE : undefined}
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  ) : (
                    <span className="skill-remove-confirm" role="status">
                      Remove &quot;{skill.name}&quot;?
                      <button type="button" className="danger-button" onClick={() => removeSkill(skill)} disabled={checking}>
                        Yes, remove
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setConfirmingRemove((current) => ({ ...current, [key]: false }))}
                        disabled={checking}
                      >
                        Cancel
                      </button>
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
