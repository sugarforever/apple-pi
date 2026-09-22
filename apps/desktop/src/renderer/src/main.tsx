import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  Blocks,
  Check,
  ChevronDown,
  CircleDashed,
  Folder,
  FolderInput,
  MessageSquare,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  X,
} from "lucide-react";
import type { CustomProviderDefinition, ProviderItem, SessionSnapshot, SkillCatalog, SkillItem, SkillScope } from "@apple-pi/protocol";
import { runSessionResync } from "../session-resync.js";
import { initialSessionState, reduceSession } from "../session-state.js";
import { toTimelineItems, type ToolItem } from "../tool-activity.js";
import type { Catalog, ModelItem, SessionItem, WorkspaceOpenResult } from "../global.js";
import { ModelSelect, modelKey, parseModelKey } from "./model-select.js";
import { modelUnavailable } from "./provider-settings.js";
import { SettingsShell } from "./settings-shell.js";
import { buildSkillScopeViewModel } from "./skill-scope-view-model.js";
import { SkillSettings } from "./skill-settings.js";
import { IconButton } from "./ui-primitives.js";
import "./styles.css";

type UiSessionItem = SessionItem & { persisted: boolean };

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const markdownToHtml = (value: string): { __html: string } => {
  const codeBlocks: string[] = [];
  const fenced = value.replace(/```([\s\S]*?)```/g, (_match, block) => {
    const i = codeBlocks.length;
    codeBlocks.push(String(block));
    return `\u0000CODEBLOCK_${i}\u0000`;
  });

  const escaped = escapeHtml(fenced)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  const withCode = codeBlocks.reduce(
    (html, block, i) => html.replace(`\u0000CODEBLOCK_${i}\u0000`, `<pre><code>${escapeHtml(block).trimEnd()}</code></pre>`),
    escaped,
  );

  return {
    __html: withCode
      .split("\n\n")
      .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br/>")}</p>`)
      .join(""),
  };
};

const makeDraftSession = (workspacePath: string): UiSessionItem => ({
  id: `draft-${Math.random().toString(36).slice(2)}`,
  path: "",
  name: `${workspacePath.split("/").at(-1) ?? "workspace"} · New session`,
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
  messageCount: 0,
  persisted: false,
});

function App() {
  const [state, dispatch] = useReducer(reduceSession, initialSessionState);
  const [catalog, setCatalog] = useState<Catalog>({ workspaces: [] });
  const [workspacePath, setWorkspacePath] = useState("");
  const [sessions, setSessions] = useState<UiSessionItem[]>([]);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomProviderDefinition[]>([]);
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalog>({ skills: [], diagnostics: [] });
  const [disabledSkills, setDisabledSkills] = useState<SkillItem[]>([]);
  const [skillCatalogWorkspacePath, setSkillCatalogWorkspacePath] = useState<string | undefined>(undefined);
  const skillRefreshToken = useRef(0);
  // After a skill mutation both lists are stale at once. Fetching them
  // together and committing in one go keeps a skill that just moved between
  // them from vanishing for a frame (gone from `skills`, not yet in
  // `disabledSkills`), which would unmount its card mid-settle.
  const refreshSkillLists = useCallback(async (catalogWorkspacePath: string): Promise<void> => {
    const token = ++skillRefreshToken.current;
    const scopes: SkillScope[] = catalogWorkspacePath ? ["user", "project"] : ["user"];
    const [catalog, disabled] = await Promise.all([window.applePi.skill.list(scopes), window.applePi.skill.listDisabled(scopes)]);
    if (skillRefreshToken.current !== token) return;
    setSkillCatalog(catalog);
    setDisabledSkills(disabled);
    setSkillCatalogWorkspacePath(catalogWorkspacePath || undefined);
  }, []);
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceSkillsOpen, setWorkspaceSkillsOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [draftSessionId, setDraftSessionId] = useState("");
  const [pendingLabel, setPendingLabel] = useState("");
  const [notice, setNotice] = useState("");
  const [appError, setAppError] = useState("");
  const modelsRefreshToken = useRef(0);

  const groupedModels = useMemo(() => {
    return models.reduce((groups, model) => {
      groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
      return groups;
    }, new Map<string, ModelItem[]>());
  }, [models]);
  const timelineItems = useMemo(() => toTimelineItems(state.messages), [state.messages]);
  const skillScopeViewModel = useMemo(
    () =>
      buildSkillScopeViewModel({
        catalog: skillCatalog,
        disabled: disabledSkills,
        workspacePath: workspacePath || undefined,
        catalogWorkspacePath: skillCatalogWorkspacePath,
      }),
    [disabledSkills, skillCatalog, skillCatalogWorkspacePath, workspacePath],
  );
  const activeModelUnavailable = state.opened && modelUnavailable(models, state.model);
  const duplicateSkillNames = useMemo(() => {
    const userNames = new Set([...skillScopeViewModel.settings.enabled, ...skillScopeViewModel.settings.disabled].map((skill) => skill.name));
    const projectNames = new Set(
      [...(skillScopeViewModel.workspace?.enabled ?? []), ...(skillScopeViewModel.workspace?.disabled ?? [])].map((skill) => skill.name),
    );
    return {
      user: new Set([...userNames].filter((name) => projectNames.has(name))),
      project: new Set([...projectNames].filter((name) => userNames.has(name))),
    };
  }, [skillScopeViewModel]);
  const workspaceName = workspacePath.split("/").filter(Boolean).at(-1) ?? "No workspace";
  const activeSessionName = activeSessionId ? (sessions.find((session) => session.id === activeSessionId)?.name ?? "New session") : "Welcome to Apple Pi";

  const showError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    dispatch({ type: "error", error: message });
    setAppError(`Something went wrong. ${message} Try again.`);
  };

  const refreshSessions = async (): Promise<void> => {
    const remoteSessions = await window.applePi.session.list();
    setSessions((current) => {
      const drafts = current.filter((session) => !session.persisted);
      const remotePaths = new Set(remoteSessions.map((session) => session.path));
      return [...remoteSessions.map((session) => ({ ...session, persisted: true })), ...drafts.filter((session) => !remotePaths.has(session.path))];
    });
  };

  const updateActiveSessionFromSnapshot = (snapshot: SessionSnapshot): void => {
    setActiveSessionId(snapshot.opened ? snapshot.sessionId : "");
    if (snapshot.opened) setDraftSessionId(snapshot.sessionId.startsWith("draft-") ? snapshot.sessionId : "");
    else setDraftSessionId("");
  };

  useEffect(() => {
    void window.applePi.workspace.list().then(setCatalog);
    void window.applePi.model
      .list()
      .then(setModels)
      .catch(() => setModels([]));
    void window.applePi.provider
      .list()
      .then(setProviders)
      .catch(() => setProviders([]));
    void window.applePi.provider
      .listCustom()
      .then(setCustomProviders)
      .catch(() => setCustomProviders([]));
    void refreshSkillLists("").catch(() => {
      setSkillCatalog({ skills: [], diagnostics: [] });
      setDisabledSkills([]);
      setSkillCatalogWorkspacePath(undefined);
    });
    return window.applePi.session.subscribe((event) => {
      if (event.type === "session.event") dispatch({ type: "event", sequence: event.sequence, payload: event.payload });
    });
  }, [refreshSkillLists]);

  // Reusing compatible Pi CLI credentials means a `pi auth login`/`logout` or a
  // models.json edit made in a terminal, while this app stayed open, should not
  // require a restart to notice. Opening Settings is the moment a user wants that
  // reflected, so it runs the same live refresh a manual "Refresh" already performs.
  useEffect(() => {
    if (!settingsOpen) return;
    const token = ++modelsRefreshToken.current;
    void window.applePi.provider
      .refreshModels()
      .then((refreshed) => {
        if (modelsRefreshToken.current !== token) return;
        setProviders(refreshed.providers);
        setModels(refreshed.models);
      })
      .catch(() => undefined);
    void window.applePi.provider
      .listCustom()
      .then(setCustomProviders)
      .catch(() => undefined);
    void refreshSkillLists(workspacePath).catch(() => undefined);
  }, [refreshSkillLists, settingsOpen, workspacePath]);

  // Runs after any authoritative model list load (startup, or a live refresh
  // below), so a default model whose provider was disconnected or removed
  // never keeps showing as selected once Apple Pi has evidence it is gone.
  useEffect(() => {
    if (!modelUnavailable(models, catalog.defaultModel)) return;
    void window.applePi.model.clearDefault().then(setCatalog);
  }, [models, catalog.defaultModel]);

  useEffect(() => {
    if (state.sync.status !== "resyncing") return;
    void runSessionResync(window.applePi.session.getSnapshot, state.sync.generation, dispatch);
  }, [state.sync.status, state.sync.generation]);

  useEffect(() => {
    if (state.sync.status === "failed") setAppError(`Something went wrong. ${state.sync.error} Try again.`);
    else if (state.sync.status === "synced") setAppError("");
  }, [state.sync.status, state.sync.generation]);

  const applyWorkspace = (result: WorkspaceOpenResult | null) => {
    if (!result) return;
    if (result.catalog) setCatalog(result.catalog);
    setWorkspacePath(result.workspacePath);
    setSkillCatalogWorkspacePath(undefined);
    setSessions(result.sessions.map((session) => ({ ...session, persisted: true })));
    updateActiveSessionFromSnapshot(result.session);
    dispatch({ type: "operation_snapshot", snapshot: result.session });
    void refreshSessions();
    void refreshSkillLists(result.workspacePath).catch(() => undefined);
  };

  const snapshotOp = async (operation: Promise<SessionSnapshot>, label = "Updating session…"): Promise<void> => {
    setPendingLabel(label);
    setAppError("");
    setNotice("");
    try {
      const snapshot = await operation;
      dispatch({ type: "operation_snapshot", snapshot });
      updateActiveSessionFromSnapshot(snapshot);
      await refreshSessions();
    } catch (error) {
      showError(error);
    } finally {
      setPendingLabel("");
    }
  };

  const openWorkspace = async (path?: string): Promise<void> => {
    setPendingLabel(path ? "Opening workspace…" : "Choosing workspace…");
    setAppError("");
    setNotice("");
    try {
      const result = path ? await window.applePi.workspace.select(path) : await window.applePi.workspace.pick();
      applyWorkspace(result);
    } catch (error) {
      showError(error);
    } finally {
      setPendingLabel("");
    }
  };

  const startDraftSession = (): void => {
    if (!workspacePath) return;
    const session = makeDraftSession(workspacePath);
    setSessions((current) => [session, ...current]);
    setActiveSessionId(session.id);
    setDraftSessionId(session.id);
    dispatch({
      type: "operation_snapshot",
      snapshot: {
        opened: true,
        sessionId: session.id,
        sessionFile: session.path,
        messages: [],
        running: false,
        model: catalog.defaultModel
          ? models.find((model) => model.provider === catalog.defaultModel?.provider && model.modelId === catalog.defaultModel.modelId)
          : state.opened
            ? state.model
            : undefined,
      },
    });
  };

  const openSession = async (session: UiSessionItem): Promise<void> => {
    setWorkspaceSkillsOpen(false);
    setActiveSessionId(session.id);
    if (!session.persisted) {
      setDraftSessionId(session.id);
      dispatch({
        type: "operation_snapshot",
        snapshot: {
          opened: true,
          sessionId: session.id,
          sessionFile: session.path,
          messages: [],
          running: false,
          model: catalog.defaultModel
            ? models.find((model) => model.provider === catalog.defaultModel?.provider && model.modelId === catalog.defaultModel.modelId)
            : state.opened
              ? state.model
              : undefined,
        },
      });
      return;
    }

    setDraftSessionId("");
    await snapshotOp(window.applePi.session.select(session.path), "Opening session…");
  };

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");

    if (draftSessionId && draftSessionId === activeSessionId) {
      await snapshotOp(window.applePi.session.create());
      dispatch({ type: "user_message", text });
      await snapshotOp(window.applePi.session.send(text));
      return;
    }

    dispatch({ type: "user_message", text });
    void snapshotOp(window.applePi.session.send(text));
  };

  const changeDefaultModel = async (value: string): Promise<void> => {
    if (!value) return;
    setPendingLabel("Saving default model…");
    setAppError("");
    setNotice("");
    try {
      setCatalog(await window.applePi.model.setDefault(parseModelKey(value)));
      setNotice("Default model saved");
    } catch (error) {
      showError(error);
    } finally {
      setPendingLabel("");
    }
  };

  return (
    <div className="shell" aria-busy={Boolean(pendingLabel)}>
      <a className="skip-link" href="#conversation">
        Skip to conversation
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">π</span>
          <span>Apple Pi</span>
        </div>
        <button className="workspace" onClick={() => void openWorkspace()}>
          <FolderInput size={17} />
          <span>Open Workspace</span>
          <kbd>⌘O</kbd>
        </button>
        <div className="section-title">
          <span>Workspaces</span>
          <small>{catalog.workspaces.length}</small>
        </div>
        <nav aria-label="Workspaces">
          {catalog.workspaces.map((workspace) => (
            <button
              key={workspace.path}
              title={workspace.path}
              className={workspacePath === workspace.path ? "selected" : ""}
              aria-current={workspacePath === workspace.path ? "page" : undefined}
              onClick={() => void openWorkspace(workspace.path)}
            >
              <span className="aside-icon">
                <Folder size={15} /> <span>{workspace.name}</span>
              </span>
            </button>
          ))}
        </nav>
        {workspacePath && (
          <>
            <div className="sessions-head">
              <span>Sessions</span>
              <small>{sessions.length}</small>
              <button aria-label="New session" title="New session" onClick={startDraftSession}>
                <Plus size={14} />
              </button>
            </div>
            <nav className="sessions">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  className={activeSessionId === session.id ? "selected" : ""}
                  aria-current={activeSessionId === session.id ? "page" : undefined}
                  onClick={() => void openSession(session)}
                >
                  <span className="session-name">
                    <MessageSquare size={13} />
                    {session.persisted ? session.name : "Untitled session"}
                  </span>
                  <small className="session-meta">
                    {session.persisted ? (
                      <>
                        {session.messageCount}
                        <span className="sr-only">{session.messageCount === 1 ? " message" : " messages"}</span>
                      </>
                    ) : (
                      "Draft"
                    )}
                  </small>
                </button>
              ))}
            </nav>
            <button
              className="workspace-skills-button"
              aria-pressed={workspaceSkillsOpen}
              onClick={() => {
                setSettingsOpen(false);
                setWorkspaceSkillsOpen(!workspaceSkillsOpen);
              }}
            >
              <Blocks size={15} /> Workspace Skills
            </button>
          </>
        )}
        <div className="sidebar-footer">
          <button
            className="settings-button"
            aria-pressed={settingsOpen}
            onClick={() => {
              setWorkspaceSkillsOpen(false);
              setSettingsOpen(!settingsOpen);
            }}
          >
            <Settings2 size={15} /> Settings
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div className="header-title">
            {settingsOpen || workspaceSkillsOpen ? (
              <strong>{settingsOpen ? "Settings" : "Workspace Skills"}</strong>
            ) : (
              <>
                <span className="header-context" title={workspacePath}>
                  {workspaceName}
                </span>
                <span className="header-separator">/</span>
                <strong>{activeSessionName}</strong>
              </>
            )}
          </div>
          <div className="header-actions">
            {(settingsOpen || workspaceSkillsOpen) && (
              <IconButton
                aria-label={settingsOpen ? "Close settings" : "Close workspace skills"}
                onClick={() => (settingsOpen ? setSettingsOpen(false) : setWorkspaceSkillsOpen(false))}
              >
                <X size={17} />
              </IconButton>
            )}
            {state.running && (
              <button className="cancel" onClick={() => void snapshotOp(window.applePi.session.cancel())}>
                <Square size={11} fill="currentColor" /> Stop
              </button>
            )}
          </div>
        </header>
        {settingsOpen ? (
          <SettingsShell
            models={models}
            groupedModels={groupedModels}
            defaultModel={catalog.defaultModel}
            onDefaultModel={(value) => void changeDefaultModel(value)}
            providerSettings={{
              providers,
              models,
              defaultModel: catalog.defaultModel,
              customProviders,
              onConnect: (providerId, apiKey) => window.applePi.provider.connectApiKey(providerId, apiKey),
              onDisconnect: (providerId) => window.applePi.provider.disconnect(providerId),
              onVerify: (providerId) => window.applePi.provider.verify(providerId),
              onAddCustomProvider: async (definition) => {
                const result = await window.applePi.provider.addCustom(definition);
                setCustomProviders(await window.applePi.provider.listCustom());
                return result;
              },
              onUpdateCustomProvider: async (id, definition) => {
                const result = await window.applePi.provider.updateCustom(id, definition);
                setCustomProviders(await window.applePi.provider.listCustom());
                return result;
              },
              onRemoveCustomProvider: async (id) => {
                const result = await window.applePi.provider.removeCustom(id);
                setCustomProviders(await window.applePi.provider.listCustom());
                return result;
              },
              onRefresh: async (providerId) => {
                const token = ++modelsRefreshToken.current;
                const refreshed = await window.applePi.provider.refreshModels([providerId]);
                // A newer refresh already landed while this one was in flight; applying
                // this stale result would clobber more current provider/model state.
                if (modelsRefreshToken.current !== token) return;
                setProviders(refreshed.providers);
                setModels(refreshed.models);
              },
              onDefaultModel: async (model) => {
                setCatalog(await window.applePi.model.setDefault(model));
                setNotice("Default model saved");
              },
              oauth: {
                start: (providerId) => window.applePi.provider.startOAuthLogin(providerId),
                respond: (operationId, promptId, value) => window.applePi.provider.respondOAuthPrompt(operationId, promptId, value),
                cancel: (operationId) => window.applePi.operation.cancel(operationId),
                subscribe: (listener) => window.applePi.provider.subscribeAuthEvent(listener),
              },
            }}
            skillSettings={{
              scope: "user",
              title: "User Skills",
              skills: skillScopeViewModel.settings.enabled,
              diagnostics: skillScopeViewModel.settings.diagnostics,
              unscopedDiagnostics: skillScopeViewModel.unscopedDiagnostics,
              disabledSkills: skillScopeViewModel.settings.disabled,
              duplicateNames: duplicateSkillNames.user,
              onInstall: async (scope, sourcePath) => {
                const result = await window.applePi.skill.install(scope, sourcePath);
                await refreshSkillLists(workspacePath);
                return result;
              },
              onSetEnabled: async (name, scope, enabled) => {
                const result = await window.applePi.skill.setEnabled(name, scope, enabled);
                await refreshSkillLists(workspacePath);
                return result;
              },
              onRemove: async (name, scope) => {
                const result = await window.applePi.skill.remove(name, scope);
                await refreshSkillLists(workspacePath);
                return result;
              },
              onPickDirectory: () => window.applePi.skill.pickDirectory(),
            }}
          />
        ) : workspaceSkillsOpen && skillScopeViewModel.workspace ? (
          <section className="settings workspace-skills">
            <SkillSettings
              scope="project"
              title="Workspace Skills"
              description={`Available only in ${workspaceName}.`}
              skills={skillScopeViewModel.workspace.enabled}
              diagnostics={skillScopeViewModel.workspace.diagnostics}
              disabledSkills={skillScopeViewModel.workspace.disabled}
              duplicateNames={duplicateSkillNames.project}
              onInstall={async (scope, sourcePath) => {
                const result = await window.applePi.skill.install(scope, sourcePath);
                await refreshSkillLists(workspacePath);
                return result;
              }}
              onSetEnabled={async (name, scope, enabled) => {
                const result = await window.applePi.skill.setEnabled(name, scope, enabled);
                await refreshSkillLists(workspacePath);
                return result;
              }}
              onRemove={async (name, scope) => {
                const result = await window.applePi.skill.remove(name, scope);
                await refreshSkillLists(workspacePath);
                return result;
              }}
              onPickDirectory={() => window.applePi.skill.pickDirectory()}
            />
          </section>
        ) : (
          <>
            <section className="timeline" id="conversation" aria-label="Conversation" role="log" aria-live="polite" tabIndex={-1}>
              {!state.opened && (
                <div className="empty">
                  <div className="orb">
                    <Sparkles size={26} />
                  </div>
                  <span className="empty-kicker">PRIVATE · LOCAL · YOURS</span>
                  <h1>Build with an agent that lives on your Mac.</h1>
                  <p>Open a workspace to start a focused coding session. Your projects and transcripts stay on this machine.</p>
                  <button onClick={() => void openWorkspace()}>
                    <FolderInput size={17} /> Open a Workspace
                  </button>
                </div>
              )}
              {timelineItems.map((item, index) =>
                item.kind === "tool" ? (
                  <ToolActivity key={`tool-${item.id}-${index}`} item={item} />
                ) : (
                  <article key={`message-${index}`} className={`message ${item.role}`}>
                    <header className="message-author">
                      <span>{item.role === "user" ? "You" : "Pi"}</span>
                    </header>
                    <div className="message-content" dangerouslySetInnerHTML={markdownToHtml(item.text)} />
                  </article>
                ),
              )}
              {state.error && (
                <div className="timeline-error" role="alert">
                  {state.error}
                </div>
              )}
            </section>
            {activeModelUnavailable && (
              <p className="model-unavailable-notice" role="status">
                This session’s model is no longer available. Choose another model to continue.
              </p>
            )}
            <footer className="composer">
              <div className="input-toolbar">
                <textarea
                  name="message"
                  autoComplete="off"
                  disabled={!state.opened || state.running}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  aria-label="Message Pi"
                  placeholder={state.opened ? "Ask Pi to build, debug, or explain…" : "Open a workspace to start"}
                />
                <div className="composer-bottom">
                  <div className="model-select-wrap">
                    {state.opened && !draftSessionId ? <Sparkles size={14} /> : <CircleDashed size={14} />}
                    <ModelSelect
                      ariaLabel="Session model"
                      models={groupedModels}
                      value={state.opened && state.model ? modelKey(state.model) : ""}
                      onChange={(value) => void snapshotOp(window.applePi.model.setSession(parseModelKey(value)))}
                      emptyLabel={state.opened ? "Default model" : "Select model"}
                      disabled={!state.opened}
                    />
                    <ChevronDown size={13} className="select-chevron" />
                  </div>
                  <span className="send-hint">↵ send · ⇧↵ new line</span>
                </div>
              </div>
              <button aria-label="Send message" disabled={!state.opened || !draft.trim() || state.running} onClick={() => void send()} title="Send message">
                <Send size={16} />
              </button>
            </footer>
          </>
        )}
      </main>
      <div className="app-feedback" aria-live="polite" aria-atomic="true">
        {pendingLabel && (
          <div className="app-status">
            <CircleDashed size={14} />
            {pendingLabel}
          </div>
        )}
        {!pendingLabel && notice && <div className="app-status success">{notice}</div>}
        {appError && (
          <div className="app-error" role="alert">
            {appError}
            {state.sync.status === "failed" && <button onClick={() => dispatch({ type: "retry_resync" })}>Retry</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolActivity({ item }: { item: ToolItem }) {
  const statusLabel = item.status === "running" ? "Running" : item.status === "error" ? "Failed" : "Completed";
  const statusIcon = item.status === "running" ? <CircleDashed size={12} /> : item.status === "error" ? <AlertCircle size={12} /> : <Check size={12} />;
  const toolLabel = item.name === "bash" ? "Terminal" : item.name.replaceAll("_", " ");

  return (
    <details className={`tool-activity status-${item.status}`}>
      <summary>
        <span className="tool-icon">
          <Terminal size={14} />
        </span>
        <span className="tool-heading">
          <strong>{toolLabel}</strong>
          <code title={item.summary}>{item.summary || "Tool call"}</code>
        </span>
        <span className="tool-status">
          {statusIcon}
          {statusLabel}
        </span>
        <ChevronDown className="tool-chevron" size={13} />
      </summary>
      <div className="tool-details">
        {item.argumentsText && (
          <section>
            <span>Input</span>
            <pre>
              <code>{item.argumentsText}</code>
            </pre>
          </section>
        )}
        {item.status === "running" ? (
          <p>Waiting for the tool to finish…</p>
        ) : (
          <section>
            <span>Output</span>
            {item.outputParts.length === 0 ? (
              <p className="tool-empty-output">Tool returned no output.</p>
            ) : (
              <div className="tool-output">
                {item.outputParts.map((part, index) =>
                  part.kind === "text" ? (
                    <pre key={`text-${index}`}>
                      <code>{part.text}</code>
                    </pre>
                  ) : (
                    <img
                      key={`image-${index}`}
                      src={`data:${part.mimeType};base64,${part.data}`}
                      alt={`${toolLabel} output`}
                      width="960"
                      height="540"
                      loading="lazy"
                    />
                  ),
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </details>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
