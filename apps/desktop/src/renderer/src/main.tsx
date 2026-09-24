import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CircleDashed, Square, X } from "lucide-react";
import type { CustomProviderDefinition, ProviderItem, SessionSnapshot, SkillCatalog, SkillItem, SkillScope } from "@apple-pi/protocol";
import { runSessionResync } from "../session-resync.js";
import { initialSessionState, reduceSession } from "../session-state.js";
import { toTimelineItems } from "../tool-activity.js";
import type { Catalog, ModelItem, WorkspaceOpenResult } from "../global.js";
import { parseModelKey } from "./model-select.js";
import { modelUnavailable } from "./provider-settings.js";
import { SettingsShell } from "./settings-shell.js";
import { materializeDraftSession, reconcileSessionList, shouldOpenSession, type UiSessionItem } from "../session-list.js";
import { buildSkillScopeViewModel } from "./skill-scope-view-model.js";
import { SkillSettings } from "./skill-settings.js";
import { IconButton } from "./ui-primitives.js";
import { AppSidebar } from "./app-sidebar.js";
import { ConversationView } from "./conversation.js";
import "./styles.css";

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
    setSessions((current) => reconcileSessionList(current, remoteSessions));
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

  const snapshotOp = async (operation: Promise<SessionSnapshot>, label = "Updating session…"): Promise<SessionSnapshot | undefined> => {
    setPendingLabel(label);
    setAppError("");
    setNotice("");
    try {
      const snapshot = await operation;
      dispatch({ type: "operation_snapshot", snapshot });
      updateActiveSessionFromSnapshot(snapshot);
      await refreshSessions();
      return snapshot;
    } catch (error) {
      showError(error);
    } finally {
      setPendingLabel("");
    }
  };

  const openWorkspace = async (path?: string, view: "conversation" | "skills" = "conversation"): Promise<void> => {
    setPendingLabel(path ? "Opening workspace…" : "Choosing workspace…");
    setAppError("");
    setNotice("");
    try {
      const result = path ? await window.applePi.workspace.select(path) : await window.applePi.workspace.pick();
      applyWorkspace(result);
      if (result) {
        setSettingsOpen(false);
        setWorkspaceSkillsOpen(view === "skills");
      }
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
    if (!shouldOpenSession(activeSessionId, session.id)) return;
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
      const materializedDraftId = draftSessionId;
      const snapshot = await snapshotOp(window.applePi.session.create(), "Starting session…");
      if (!snapshot?.opened) return;
      setSessions((current) => materializeDraftSession(current, materializedDraftId, snapshot));
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
      <AppSidebar
        catalog={catalog}
        workspacePath={workspacePath}
        sessions={sessions}
        activeSessionId={activeSessionId}
        settingsOpen={settingsOpen}
        onOpenWorkspace={(path, view) => void openWorkspace(path, view)}
        onStartSession={startDraftSession}
        onOpenSession={(session) => void openSession(session)}
        onToggleSettings={() => {
          setWorkspaceSkillsOpen(false);
          setSettingsOpen(!settingsOpen);
        }}
      />
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
          <ConversationView
            state={state}
            timelineItems={timelineItems}
            activeModelUnavailable={activeModelUnavailable}
            draft={draft}
            draftSessionId={draftSessionId}
            models={groupedModels}
            onDraftChange={setDraft}
            onOpenWorkspace={() => void openWorkspace()}
            onModelChange={(value) => void snapshotOp(window.applePi.model.setSession(parseModelKey(value)))}
            onSend={() => void send()}
          />
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
