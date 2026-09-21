import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./src/main.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./src/styles.css", import.meta.url), "utf8");
const settings = readFileSync(new URL("./src/settings-shell.tsx", import.meta.url), "utf8");
const primitives = readFileSync(new URL("./src/ui-primitives.tsx", import.meta.url), "utf8");
const modelSelect = readFileSync(new URL("./src/model-select.tsx", import.meta.url), "utf8");
const document = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const rule = (selector: string, source = styles): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

describe("renderer accessibility contract", () => {
  it("exposes selected navigation state to assistive technology", () => {
    expect(source).toContain('aria-current={workspacePath === workspace.path ? "page" : undefined}');
    expect(source).toContain('aria-current={activeSessionId === session.id ? "page" : undefined}');
  });

  it("keeps compact session counts meaningful to assistive technology", () => {
    expect(source).toContain('className="sr-only">{session.messageCount === 1 ? " message" : " messages"}');
  });

  it("labels composer controls", () => {
    expect(source).toContain('name="message"');
    expect(source).toContain('autoComplete="off"');
    expect(source).toContain('ariaLabel="Session model"');
    expect(modelSelect).toContain("aria-label={props.ariaLabel}");
    expect(source).toContain('aria-label="Send message"');
  });

  it("provides an accessible provider onboarding flow", () => {
    const providers = readFileSync(new URL("./src/provider-settings.tsx", import.meta.url), "utf8");
    expect(providers).toContain('type="password"');
    expect(providers).toContain("<SearchField");
    expect(primitives).toContain('type="search"');
    expect(providers).toContain("aria-busy={checking}");
    expect(providers).toContain('role={diagnostic.severity === "error" ? "alert" : "status"}');
    expect(settings).toContain('<a href="#providers-title">Connect a provider</a>');
  });

  it("announces conversation updates and errors", () => {
    expect(source).toContain('role="log"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="alert"');
  });

  it("uses semantic message attribution instead of a form label", () => {
    expect(source).toContain('<header className="message-author">');
    expect(source).not.toContain("<label><span>");
  });
});

describe("renderer visual contract", () => {
  it("uses a compact single-line conversation header", () => {
    expect(source).not.toContain('state.opened ? "Active session"');
    expect(source).toContain('className="header-context"');
    expect(rule("main")).toContain("grid-template-rows: 48px minmax(0, 1fr) auto");
    expect(rule(".header-title")).toContain("flex-direction: row");
  });

  it("renders ordinary messages without card chrome", () => {
    const userMessage = rule(".message.user .message-content");
    expect(userMessage).not.toContain("border:");
    expect(userMessage).not.toContain("background:");
    expect(userMessage).not.toContain("padding:");
    expect(rule(".message")).toContain("margin: 0 0 22px");
  });

  it("renders tool activity as a disclosure row rather than a card", () => {
    const activity = rule(".tool-activity");
    expect(activity).not.toContain("border:");
    expect(activity).not.toContain("background:");
    expect(rule(".tool-icon")).not.toContain("border:");
    expect(rule(".tool-icon")).not.toContain("background:");
  });

  it("isolates tool statuses from conversation error styling", () => {
    expect(source).toContain("className={`tool-activity status-${item.status}`}");
    expect(source).toContain('className="timeline-error"');
    expect(source).not.toContain("className={`tool-activity ${item.status}`}");
    expect(rule(".timeline-error")).toContain("border: 1px solid #75413a");
  });

  it("uses quiet local focus treatments for tool rows and the composer", () => {
    expect(rule(".timeline:focus-visible")).toContain("box-shadow: inset 2px 0 var(--text-tertiary)");
    expect(rule(".tool-activity summary:focus-visible")).toContain("outline: 0");
    expect(rule(".tool-activity summary:focus-visible")).toContain("box-shadow: inset 2px 0 var(--text-secondary)");
    expect(rule(".composer:focus-within")).toContain("outline: 0");
    expect(rule(".composer:focus-within")).toContain("border-color: var(--text-tertiary)");
    expect(rule(".composer:focus-within")).not.toContain("var(--accent)");
  });

  it("keeps collapsed tool activity visually subordinate to conversation text", () => {
    expect(rule(".tool-activity")).toContain("margin: 0 0 14px");
    expect(rule(".tool-activity summary")).toContain("padding: 2px 0");
    expect(rule(".tool-heading strong")).toContain("color: var(--text-tertiary)");
    expect(rule(".tool-heading strong")).toContain("font-size: 11px");
    expect(rule(".tool-heading code")).toContain("color: var(--text-tertiary)");
    expect(rule(".tool-status")).toContain("color: var(--text-tertiary)");
    expect(rule(".tool-activity summary:hover .tool-heading strong")).toContain("color: var(--text-secondary)");
    expect(rule(".tool-icon")).toContain("width: 20px");
  });

  it("keeps the composer compact and reserves emphasis for focus", () => {
    expect(rule(".composer textarea")).toContain("min-height: 42px");
    expect(rule(".composer")).not.toContain("box-shadow:");
    expect(rule(".composer:focus-within")).toContain("border-color:");
  });

  it("uses compact navigation and plain settings content", () => {
    expect(rule(".shell")).toContain("grid-template-columns: 248px minmax(0, 1fr)");
    expect(source).toContain('className="session-meta"');
    expect(rule(".settings-card")).not.toContain("border:");
    expect(rule(".settings-card")).not.toContain("background:");
  });

  it("omits implementation-status copy from the sidebar", () => {
    expect(source).not.toContain("Local agent");
    expect(source).not.toContain("Running locally");
    expect(styles).not.toContain(".local-status");
  });

  it("prioritizes the session title over workspace context on narrow screens", () => {
    const narrowScreenRules = styles.match(/@media \(max-width: 620px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(rule(".header-context", narrowScreenRules)).toContain("display: none;");
  });

  it("keeps the chat composer inside the viewport while messages scroll", () => {
    const mainRule = rule("main");
    const timelineRule = rule(".timeline");

    expect(mainRule).toContain("min-height: 0");
    expect(mainRule).toContain("overflow: hidden");
    expect(timelineRule).toContain("min-height: 0");
    expect(timelineRule).toContain("overflow: auto");
  });

  it("uses a local system type stack and explicit readable type tokens", () => {
    expect(styles).not.toContain("fonts.googleapis.com");
    expect(styles).toContain("--text-body: 14px");
    expect(styles).toContain("--text-ui: 13px");
    expect(styles).toContain("--text-meta: 11px");
    expect(styles).toContain("--control-height: 34px");
    expect(styles).toContain("--content-width: 620px");
  });

  it("provides component-level focus treatments", () => {
    expect(styles).toContain(".composer:focus-within");
    expect(styles).toContain(".model-select:focus-visible");
  });

  it("optimizes long conversation rendering", () => {
    expect(styles).toContain("content-visibility: auto");
    expect(styles).toContain("contain-intrinsic-size");
  });

  it("sets native dark chrome metadata", () => {
    // Matched rather than compared to an exact tag: Prettier owns the document's
    // serialization, so pinning byte-for-byte here breaks on any reformat.
    expect(document).toMatch(/<meta\s+name="theme-color"\s+content="#0b0d0d"\s*\/?>/);
  });
});

describe("renderer model recovery contract", () => {
  it("clears a stale default model after any authoritative model list load, not only after a manual refresh", () => {
    expect(source).toContain("[models, catalog.defaultModel]");
    expect(source).toContain("void window.applePi.model.clearDefault().then(setCatalog);");
  });

  it("guards provider-triggered model refreshes against stale out-of-order responses", () => {
    expect(source).toContain("const modelsRefreshToken = useRef(0);");
    expect(source).toContain("if (modelsRefreshToken.current !== token) return;");
  });

  it("tells the user when the active session's model is no longer available", () => {
    expect(source).toContain("const activeModelUnavailable = state.opened && modelUnavailable(models, state.model);");
    expect(source).toContain('className="model-unavailable-notice"');
  });
});

describe("renderer credential reuse contract", () => {
  it("reloads provider and model state whenever Settings is opened, to reflect external CLI credential and models.json changes", () => {
    expect(source).toContain("if (!settingsOpen) return;");
    expect(source).toContain("window.applePi.provider\n      .refreshModels()");
    expect(source).toContain("}, [settingsOpen]);");
  });

  it("labels a shell-command-backed credential distinctly from a stored key or environment variable", () => {
    const providers = readFileSync(new URL("./src/provider-settings.tsx", import.meta.url), "utf8");
    expect(providers).toContain('command: "Shell command",');
  });
});

describe("renderer OAuth sign-in contract", () => {
  const providers = readFileSync(new URL("./src/provider-settings.tsx", import.meta.url), "utf8");

  it("offers a Sign in action for an oauth-capable provider that has no api_key method to fall back on", () => {
    expect(providers).toContain("export function canStartOAuthLogin(provider: ProviderItem): boolean {");
    expect(providers).toContain('provider.authMethods.includes("oauth") && provider.status !== "connected"');
    expect(providers).toContain("{canStartOAuthLogin(provider) && !isOAuthActive && (");
  });

  it("relays every AuthInteraction step (auth url, device code, progress, and prompt) without ever rendering a raw token", () => {
    expect(providers).toContain('latest?.type === "auth_url"');
    expect(providers).toContain('latest?.type === "device_code"');
    expect(providers).toContain('latest?.type === "progress"');
    expect(providers).toContain('latest?.type === "prompt" && latest.prompt.type === "select"');
    expect(providers).not.toContain("credential.access");
    expect(providers).not.toContain("credential.refresh");
  });

  it("lets a select prompt answer with one click and a text/secret/manual_code prompt answer through a form", () => {
    expect(providers).toContain("onClick={() => props.onSubmit(option.id)}");
    expect(providers).toContain('type={latest.prompt.type === "secret" ? "password" : "text"}');
  });

  it("always offers a way to cancel an in-flight sign-in", () => {
    expect(providers).toContain("Cancel sign-in");
    expect(providers).toContain("onClick={props.onCancel}");
  });

  it("opens the system browser automatically for an auth_url step, from the main process rather than the renderer", () => {
    const main = readFileSync(new URL("../main/index.ts", import.meta.url), "utf8");
    expect(main).toContain('if (event.payload.type === "auth_url")');
    expect(main).toContain("void shell.openExternal(event.payload.url)");
  });
});

describe("renderer custom provider contract", () => {
  const providers = readFileSync(new URL("./src/provider-settings.tsx", import.meta.url), "utf8");

  it("offers an Add custom provider action alongside built-in provider search", () => {
    expect(providers).toContain("Add custom provider");
    expect(providers).toContain('setCustomProviderForm(customProviderForm === "add" ? null : "add")');
  });

  it("only offers Edit and Remove for providers Apple Pi's custom-provider store manages", () => {
    expect(providers).toContain("const isCustom = isCustomProvider(provider.id, props.customProviders);");
    expect(providers).toContain("{isCustom && !isEditingCustomProvider && (");
    expect(providers).toContain("{isCustom && (");
  });

  it("submits only the single supported OpenAI-compatible api type, without exposing a one-option picker", () => {
    expect(providers).toContain('const CUSTOM_PROVIDER_API = "openai-completions" as const;');
    expect(providers).toContain("OpenAI-compatible (Chat Completions API)");
  });

  it("requires at least one model before submitting a custom provider", () => {
    expect(providers).toContain("if (models.length === 0) {");
    expect(providers).toContain('message: "Add at least one model."');
  });

  it("never lets a custom provider's id be changed once created", () => {
    expect(providers).toContain("disabled={editing || props.busy}");
  });

  it("keeps a custom provider's connect/verify/disable flow identical to a built-in provider's", () => {
    // Custom providers reuse the same connect/verify/disconnect buttons as built-in
    // providers below this point in the file; only Edit/Remove are new.
    expect(providers).toContain('{provider.status === "connected" && provider.credentialSource === "apple_pi" && (');
  });
});

describe("renderer skills settings contract", () => {
  const skills = readFileSync(new URL("./src/skill-settings.tsx", import.meta.url), "utf8");

  it("provides an accessible, searchable skills list with per-item busy state", () => {
    expect(skills).toContain('<section className="skill-settings" aria-labelledby="skills-title">');
    expect(skills).toContain("<SearchField");
    expect(skills).toContain("aria-busy={checking}");
  });

  it("surfaces per-skill and catalog-level diagnostics with an accessible role, adapted from type instead of severity", () => {
    expect(skills).toContain('export function diagnosticRole(type: SkillDiagnostic["type"]): "alert" | "status" {');
    expect(skills).toContain("role={diagnosticRole(diagnostic.type)}");
    // Catalog-level diagnostics are packed into one collapsed line per type
    // (see groupSkillDiagnostics in skill-settings.test.ts), not one banner
    // per diagnostic; the role lands on the summary so it is still announced.
    expect(skills).toContain("groupSkillDiagnostics(props.diagnostics).map((group) => (");
    expect(skills).toContain("<details key={`catalog-diagnostic-${group.type}`} className={`skill-diagnostic skill-diagnostic-group ${group.type}`}>");
    expect(skills).toContain("<summary role={diagnosticRole(group.type)}>{group.headline}</summary>");
    expect(skills).not.toContain("props.diagnostics.map(");
    expect(rule(".skill-diagnostic-group summary")).toContain("cursor: pointer");
  });

  it("offers a labelled install control that drives a native directory picker with a scope choice", () => {
    expect(skills).toContain('aria-label="Install skill"');
    expect(skills).toContain("onClick={() => void pickDirectory()}");
    expect(skills).toContain("props.onPickDirectory()");
    expect(skills).toContain("props.canInstallToProject &&");
  });

  // Issue #68: with no workspace open, the panel used to just show fewer
  // skills with no explanation. Now it says so explicitly, reusing the same
  // `canInstallToProject` flag the install form's project-scope radio
  // already keys off (see the test above), rather than adding a second
  // "is a workspace open" signal.
  it("explains when project-scope skill management isn't available, instead of silently showing fewer skills", () => {
    expect(skills).toContain("export function projectScopeNotice(canInstallToProject: boolean): string | undefined {");
    expect(skills).toContain("projectScopeNotice(props.canInstallToProject)");
  });

  it("offers a per-skill enable/disable toggle wired to onSetEnabled", () => {
    expect(skills).toContain("aria-pressed={enabled}");
    expect(skills).toContain("onClick={() => toggleEnabled(skill)}");
    expect(skills).toContain("const target = !isSkillEnabled(skill);");
    expect(skills).toContain("props.onSetEnabled(skill.name, skill.scope, target)");
  });

  it("flips the toggle to its target state immediately and shows a settling effect until the refreshed lists land, without freezing the button", () => {
    // Optimistic target, keyed like the rest of the per-skill state.
    expect(skills).toContain("const [pendingEnabled, setPendingEnabled] = useState<Record<string, boolean | undefined>>({});");
    expect(skills).toContain("const enabled = pendingEnabled[key] ?? isSkillEnabled(skill);");
    expect(skills).toContain("const settling = pendingEnabled[key] !== undefined;");
    // The round trip runs inside a React Transition; the clear after the
    // await opts back in (React 19 drops updates after the first await
    // from the transition otherwise).
    expect(skills).toContain("const [, startToggleTransition] = useTransition();");
    expect(skills).toContain("startToggleTransition(async () => {");
    expect(skills).toContain("startTransition(() => setPendingEnabled((current) => ({ ...current, [key]: undefined })));");
    // Visible + announced settling state; a repeat click is ignored in code
    // rather than by disabling the button, which would drop focus.
    expect(skills).toContain("aria-busy={settling}");
    expect(skills).toContain("if (pendingEnabled[key] !== undefined) return;");
    expect(skills).toContain(
      '{settling ? <CircleDashed size={16} className="skill-toggle-settling" /> : enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}',
    );
    expect(skills).toContain('{settling ? (enabled ? "Enabling…" : "Disabling…") : enabled ? "Enabled" : "Disabled"}');
    expect(rule(".skill-toggle")).toContain("transition:");
    expect(rule('.skill-toggle[aria-busy="true"]')).toContain("cursor: progress");
    expect(rule(".skill-toggle-settling")).toContain("animation: status-spin");
  });

  it("keeps the card free of the on-disk path, leaving it as a hover title on the name", () => {
    expect(skills).not.toContain('className="skill-path"');
    expect(skills).toContain("<h3 title={skill.path}>{skill.name}</h3>");
    expect(styles).not.toContain(".skill-path");
  });

  it("requires a confirmation step before removing a skill", () => {
    expect(skills).toContain("onClick={() => setConfirmingRemove((current) => ({ ...current, [key]: true }))}");
    expect(skills).toContain("onClick={() => removeSkill(skill)}");
    expect(skills).toContain('role="status"');
  });

  it("offers Remove as a compact icon-only button in the card's header row, not a full-width action row below it", () => {
    expect(skills).toContain('<div className="skill-controls">');
    expect(skills).toContain('className="skill-remove"');
    expect(skills).toContain("aria-label={`Remove ${skill.name}`}");
    expect(skills).toContain('<Trash2 size={14} aria-hidden="true" />');
    expect(skills).not.toContain('className="skill-actions"');
    expect(skills).not.toContain("<Trash2 size={13} /> Remove");
    expect(rule(".skill-remove")).toContain("width: 28px");
    expect(rule(".skill-remove")).toContain("background: transparent");
    expect(styles).not.toContain(".skill-actions");
  });

  it("disables mutating controls for a skill Apple Pi does not manage, with an explanatory title", () => {
    expect(skills).toContain("disabled={checking || !skill.managed}");
    expect(skills).toContain("NOT_MANAGED_TITLE");
  });

  it("shows enabled and disabled skills together in one alphabetically sorted list, with no separate section", () => {
    expect(skills).toContain("disabledSkills: SkillItem[];");
    expect(skills).not.toContain('<details className="skill-disabled');
    expect(skills).not.toContain("skill-disabled-section");
    expect(skills).not.toContain("const enableSkill");
    expect(skills).not.toContain("const visibleDisabled");
    // The merge lives in an exported, unit-tested helper (see
    // skill-settings.test.ts): one row per scope+name, the discovered
    // (enabled) entry winning, so two same-keyed cards can never render.
    expect(skills).toContain("const combined = useMemo(() => mergeSkillLists(props.skills, props.disabledSkills), [props.skills, props.disabledSkills]);");
    expect(skills).toContain("export function mergeSkillLists(skills: SkillItem[], disabledSkills: SkillItem[]): SkillItem[]");
    expect(skills).toContain("if (!byKey.has(key)) byKey.set(key, skill);");
  });

  it("filters the combined list by the same search query, and re-enabling a disabled skill reuses the same toggle", () => {
    expect(skills).toContain("const visible = useMemo(() => {");
    expect(skills).toContain("combined.filter((skill) => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(needle))");
    expect(skills).toContain("onClick={() => toggleEnabled(skill)}");
  });
});

describe("renderer skills settings mounting contract", () => {
  it("mounts the typed Settings shell with Provider and Skill settings wired to their existing owners", () => {
    expect(source).toContain("<SettingsShell");
    expect(settings).toContain("<ProviderSettings {...props.providerSettings} />");
    expect(settings).toContain("<SkillSettings {...props.skillSettings} />");
    expect(source).toContain("window.applePi.skill.list()");
    expect(source).toContain("onInstall: async (scope, sourcePath) => {");
    expect(source).toContain("onPickDirectory: () => window.applePi.skill.pickDirectory()");
    expect(source).toContain("canInstallToProject: Boolean(workspacePath)");
  });

  it("fetches and passes disabled skills alongside the enabled catalog, refreshed at the same points", () => {
    expect(source).toContain("window.applePi.skill.listDisabled()");
    expect(source).toContain("disabledSkills,");
    // Refreshed on mount and whenever Settings opens, matching skillCatalog's own refresh points.
    expect(source).toContain("setDisabledSkills");
  });

  it("refreshes both skill lists together after a mutation, so a skill moving between them never vanishes for a frame", () => {
    expect(source).toContain("const [catalog, disabled] = await Promise.all([window.applePi.skill.list(), window.applePi.skill.listDisabled()]);");
    expect(source).toContain("const result = await window.applePi.skill.setEnabled(name, scope, enabled);\n                await refreshSkillLists();");
    expect(source).toContain("const result = await window.applePi.skill.remove(name, scope);\n                await refreshSkillLists();");
  });
});

describe("renderer feedback contract", () => {
  it("resyncs only after the reducer marks a gap or explicit resync event", () => {
    expect(source).toContain('if (state.sync.status !== "resyncing") return;');
    expect(source).toContain("runSessionResync(");
    expect(source).toContain("[state.sync.status, state.sync.generation]");
    expect(source).not.toContain(
      'dispatch({ type: "event", sequence: event.sequence, payload: event.payload });\n      void window.applePi.session.getSnapshot()',
    );
  });

  it("offers explicit recovery after a resync failure", () => {
    expect(source).toContain('state.sync.status === "failed"');
    expect(source).toContain('dispatch({ type: "retry_resync" })');
    expect(rule(".app-error button")).toContain("pointer-events: auto");
  });

  it("keeps a sent user message visible while agent events stream", () => {
    expect(source).toContain('dispatch({ type: "user_message", text });');
  });

  it("exposes a shared pending state", () => {
    expect(source).toContain('const [pendingLabel, setPendingLabel] = useState("")');
    expect(source).toContain("aria-busy={Boolean(pendingLabel)}");
    expect(source).toContain('className="app-status"');
  });

  it("shows settings save progress and confirmation", () => {
    expect(source).toContain('setPendingLabel("Saving default model…")');
    expect(source).toContain('setNotice("Default model saved")');
  });

  it("keeps errors visible outside individual views", () => {
    expect(source).toContain('className="app-error"');
    expect(source).toContain("Something went wrong.");
  });
});
