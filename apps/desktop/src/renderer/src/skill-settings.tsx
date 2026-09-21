import React, { startTransition, useMemo, useState, useTransition } from "react";
import { AlertCircle, CircleDashed, FolderOpen, Plus, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import type { SkillDiagnostic, SkillItem, SkillOperationResult, SkillScope } from "@apple-pi/protocol";
import { Notice, SearchField, SectionHeading } from "./ui-primitives.js";

export type SkillActivity = "idle" | "checking";

export interface SkillSettingsProps {
  skills: SkillItem[];
  diagnostics: SkillDiagnostic[];
  unscopedDiagnostics?: SkillDiagnostic[];
  // Skills currently sitting in Apple Pi's disabled holding directory (see
  // `PiSkillService.listDisabled` in `@apple-pi/pi-adapter`'s skill-service.ts).
  // Deliberately a separate list rather than folded into `skills`: a disabled
  // skill is, by design, invisible to Pi's own discovery, and `skills` mirrors
  // that discovery exactly. This is Apple Pi's own bookkeeping layered on top,
  // so the panel can still show a disabled skill and offer to re-enable it.
  disabledSkills: SkillItem[];
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

// With no workspace open, `skills`/`disabledSkills` only ever contain
// user-scope entries (see `skill:list`'s IPC handler in
// `apps/desktop/src/main/index.ts` and `PiSkillService.list` in
// `@apple-pi/pi-adapter`, which skip project-scope discovery entirely rather
// than fake it). Silently showing fewer skills with no explanation is exactly
// what made global skills look "invisible" instead of merely
// project-skills-unavailable (see issue #68); this names the reason instead.
export function projectScopeNotice(canInstallToProject: boolean): string | undefined {
  return canInstallToProject
    ? undefined
    : "No workspace is open, so project-scoped skills aren't shown or manageable here. Only skills installed for this user are listed below.";
}

// One row per scope+name. `skills` and `disabledSkills` are disjoint by
// construction on the host side (see `PiSkillService.listDisabled`), but a
// same-keyed entry in both would render two cards sharing one React key and
// one activity/feedback slot -- the "state lost track" failure -- so the
// discovered (enabled) entry wins here too rather than trusting that alone.
export function mergeSkillLists(skills: SkillItem[], disabledSkills: SkillItem[]): SkillItem[] {
  const byKey = new Map<string, SkillItem>();
  for (const skill of [...skills, ...disabledSkills]) {
    const key = skillKey(skill.scope, skill.name);
    if (!byKey.has(key)) byKey.set(key, skill);
  }
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
}

// One collapsed line per diagnostic type instead of one banner per
// diagnostic. Catalog-level diagnostics are mostly benign and repetitive --
// a dozen "name collision" entries when the same skill sits in both
// `~/.pi/agent/skills` and `~/.agents/skills`, which Pi resolves by itself --
// so a wall of red alerts buried the list without telling the user anything
// actionable. The count and a plain-language headline go in the summary;
// each entry's own message (and, for a collision, which copy won) stays
// available on expand for anyone who wants to clean up.
export interface SkillDiagnosticGroup {
  type: SkillDiagnostic["type"];
  headline: string;
  items: string[];
}

const DIAGNOSTIC_TYPE_ORDER: SkillDiagnostic["type"][] = ["error", "collision", "warning"];

function diagnosticHeadline(type: SkillDiagnostic["type"], count: number): string {
  const skills = count === 1 ? "1 skill" : `${count} skills`;
  switch (type) {
    case "error":
      return `${skills} could not be loaded.`;
    case "collision":
      return `${skills} ${count === 1 ? "exists" : "exist"} in more than one skills folder; the first copy found is used.`;
    case "warning":
      return `${skills} ${count === 1 ? "has" : "have"} a warning.`;
  }
}

function diagnosticDetail(diagnostic: SkillDiagnostic): string {
  if (diagnostic.collision) return `${diagnostic.collision.name}: using ${diagnostic.collision.winnerPath}, ignoring ${diagnostic.collision.loserPath}`;
  return diagnostic.path ? `${diagnostic.message} (${diagnostic.path})` : diagnostic.message;
}

export function groupSkillDiagnostics(diagnostics: SkillDiagnostic[]): SkillDiagnosticGroup[] {
  return DIAGNOSTIC_TYPE_ORDER.flatMap((type) => {
    const matching = diagnostics.filter((diagnostic) => diagnostic.type === type);
    if (matching.length === 0) return [];
    return [{ type, headline: diagnosticHeadline(type, matching.length), items: matching.map(diagnosticDetail) }];
  });
}

export function SkillSettings(props: SkillSettingsProps) {
  const [query, setQuery] = useState("");
  const [activity, setActivity] = useState<Record<string, SkillActivity>>({});
  const [feedback, setFeedback] = useState<Record<string, SkillDiagnostic | undefined>>({});
  // The state a toggle is *heading to* while its setEnabled round trip (move
  // on disk, then re-fetch both lists) is still in flight, keyed like
  // `activity`. The card shows this target straight away rather than the
  // stale pre-click state, so a click reads as an immediate flip with a
  // brief "settling" effect instead of a frozen button; it is cleared once
  // the refreshed lists (the real state) arrive, which for a rejected
  // operation simply snaps the toggle back next to its diagnostic.
  const [pendingEnabled, setPendingEnabled] = useState<Record<string, boolean | undefined>>({});
  // Marks the post-operation list refresh as a React Transition, so React
  // keeps the current cards interactive and never blocks the toggle's own
  // settling effect on the (potentially large) re-render that follows.
  const [, startToggleTransition] = useTransition();
  // Two-step "arm, then confirm" pattern for Remove: the first click swaps
  // the button for an inline "Remove ‘x’? Yes / Cancel" prompt (role="status"
  // announces the swap to assistive tech) rather than firing the destructive
  // call immediately or opening a separate dialog.
  const [confirmingRemove, setConfirmingRemove] = useState<Record<string, boolean>>({});
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [installScope, setInstallScope] = useState<SkillScope>("user");
  const [installBusy, setInstallBusy] = useState(false);
  const [installFeedback, setInstallFeedback] = useState<SkillDiagnostic | undefined>(undefined);

  // Enabled and disabled skills render as one alphabetically sorted list —
  // each card's own toggle already shows "Enabled"/"Disabled", so a separate
  // section just added a second place to look without adding information.
  const combined = useMemo(() => mergeSkillLists(props.skills, props.disabledSkills), [props.skills, props.disabledSkills]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? combined.filter((skill) => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(needle)) : combined;
  }, [combined, query]);

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
    const key = skillKey(skill.scope, skill.name);
    if (pendingEnabled[key] !== undefined) return;
    const target = !isSkillEnabled(skill);
    setPendingEnabled((current) => ({ ...current, [key]: target }));
    startToggleTransition(async () => {
      await run(key, () => props.onSetEnabled(skill.name, skill.scope, target));
      // React 19 only treats updates *before* the first await as part of
      // the transition; the clear after it has to opt in again.
      startTransition(() => setPendingEnabled((current) => ({ ...current, [key]: undefined })));
    });
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
      <SectionHeading
        id="skills-title"
        title="Skills"
        description="Extend Apple Pi with reusable skills the model can invoke, installed per user or per project."
        actions={<SearchField label="Search skills" placeholder="Search skills" value={query} onChange={setQuery} />}
      />
      {groupSkillDiagnostics(props.diagnostics).map((group) => (
        <details key={`catalog-diagnostic-${group.type}`} className={`skill-diagnostic skill-diagnostic-group ${group.type}`}>
          <summary role={diagnosticRole(group.type)}>{group.headline}</summary>
          <ul>
            {group.items.map((item, index) => (
              <li key={`${group.type}-${index}`}>{item}</li>
            ))}
          </ul>
        </details>
      ))}
      {groupSkillDiagnostics(props.unscopedDiagnostics ?? []).map((group) => (
        <details key={`unscoped-catalog-diagnostic-${group.type}`} className={`skill-diagnostic skill-diagnostic-group ${group.type}`}>
          <summary role={diagnosticRole(group.type)}>Unscoped: {group.headline}</summary>
          <ul>
            {group.items.map((item, index) => (
              <li key={`${group.type}-${index}`}>{item}</li>
            ))}
          </ul>
        </details>
      ))}
      {projectScopeNotice(props.canInstallToProject) && (
        <p className="skill-scope-notice" role="status">
          {projectScopeNotice(props.canInstallToProject)}
        </p>
      )}
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
      {combined.length === 0 ? (
        <Notice className="skill-empty">
          <AlertCircle size={22} />
          <strong>No skills installed</strong>
          <p>Install a skill directory to make it available to the model.</p>
        </Notice>
      ) : visible.length === 0 ? (
        <Notice className="skill-empty">
          <strong>No matching skills</strong>
          <p>Try a different search term.</p>
        </Notice>
      ) : (
        <div className="skill-list">
          {visible.map((skill) => {
            const key = skillKey(skill.scope, skill.name);
            const checking = activity[key] === "checking";
            const settling = pendingEnabled[key] !== undefined;
            // While settling, the toggle already shows where it is heading.
            const enabled = pendingEnabled[key] ?? isSkillEnabled(skill);
            const diagnostic = feedback[key];
            const confirming = confirmingRemove[key] ?? false;
            return (
              <article className="skill-card" key={key} aria-busy={checking}>
                <div className="skill-summary">
                  <div className="skill-name">
                    <h3 title={skill.path}>{skill.name}</h3>
                    <p>
                      {skill.scope} · {skill.managed ? "Apple Pi managed" : "Not managed by Apple Pi"}
                    </p>
                  </div>
                  <div className="skill-controls">
                    <button
                      type="button"
                      className="skill-toggle"
                      aria-label={enabled ? `Disable ${skill.name}` : `Enable ${skill.name}`}
                      aria-pressed={enabled}
                      aria-busy={settling}
                      onClick={() => toggleEnabled(skill)}
                      // Stays enabled (and focusable) while settling: toggleEnabled
                      // ignores the repeat click itself, and a disabled button would
                      // drop keyboard focus mid-operation and dim the effect.
                      disabled={!skill.managed}
                      title={!skill.managed ? NOT_MANAGED_TITLE : undefined}
                    >
                      {settling ? <CircleDashed size={16} className="skill-toggle-settling" /> : enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                      {settling ? (enabled ? "Enabling…" : "Disabling…") : enabled ? "Enabled" : "Disabled"}
                    </button>
                    {/* Remove lives in the header row as an icon-only button, so
                        a card costs no extra height for a rarely used action; the
                        two-step confirm swaps in beside the toggle, in place. */}
                    {!confirming ? (
                      <button
                        type="button"
                        className="skill-remove"
                        aria-label={`Remove ${skill.name}`}
                        onClick={() => setConfirmingRemove((current) => ({ ...current, [key]: true }))}
                        disabled={checking || !skill.managed}
                        title={!skill.managed ? NOT_MANAGED_TITLE : `Remove ${skill.name}`}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    ) : (
                      <span className="skill-remove-confirm" role="status">
                        Remove?
                        <button type="button" className="danger-button" onClick={() => removeSkill(skill)} disabled={checking}>
                          Yes
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
                </div>
                <p className="skill-description">{skill.description}</p>
                {diagnostic && (
                  <p className={`skill-diagnostic ${diagnostic.type}`} role={diagnosticRole(diagnostic.type)}>
                    {diagnostic.message}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
