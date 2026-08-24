import React, { useEffect, useMemo, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChevronDown, CircleDashed, Folder, FolderInput, MessageSquare, Plus, Send, Settings2, Sparkles, Square, X } from "lucide-react";
import { initialSessionState, reduceSession, type SessionSnapshot } from "../session-state.js";
import type { Catalog, ModelItem, ModelRef, SessionItem, WorkspaceOpenResult } from "../global.js";
import "./styles.css";

type UiSessionItem = SessionItem & { persisted: boolean };

function textOf(message: unknown): string {
  const record = message as { role?: string; content?: unknown };
  if (typeof record?.content === "string") return record.content;
  if (Array.isArray(record?.content)) {
    return record.content
      .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return JSON.stringify(message, null, 2);
}
const modelKey = (model: ModelRef) => `${model.provider}::${model.modelId}`;
const parseModelKey = (value: string): ModelRef => {
  const [provider, modelId] = value.split("::");
  return { provider: provider!, modelId: modelId! };
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

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
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [draftSessionId, setDraftSessionId] = useState("");
  const [pendingLabel, setPendingLabel] = useState("");
  const [notice, setNotice] = useState("");
  const [appError, setAppError] = useState("");

  const groupedModels = useMemo(() => {
    return models.reduce((groups, model) => {
      groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
      return groups;
    }, new Map<string, ModelItem[]>());
  }, [models]);

  const showError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    dispatch({ type: "error", error: message });
    setAppError(`Something went wrong. ${message} Try again.`);
  };

  const refreshSessions = async (): Promise<void> => {
    const remoteSessions = (await window.applePi.session.list()) as SessionItem[];
    setSessions((current) => {
      const drafts = current.filter((session) => !session.persisted);
      const remotePaths = new Set(remoteSessions.map((session) => session.path));
      return [...remoteSessions.map((session) => ({ ...session, persisted: true })), ...drafts.filter((session) => !remotePaths.has(session.path))];
    });
  };

  const updateActiveSessionFromSnapshot = (snapshot: SessionSnapshot): void => {
    setActiveSessionId(snapshot.sessionId ?? snapshot.sessionFile ?? "");
    if (snapshot.opened) setDraftSessionId(snapshot.sessionId?.startsWith("draft-") ? snapshot.sessionId : "");
    else if (!snapshot.opened) setDraftSessionId("");
  };

  useEffect(() => {
    void window.applePi.workspace.list().then(setCatalog);
    void window.applePi.model.list().then(setModels).catch(() => setModels([]));
    return window.applePi.session.subscribe((event) => {
      dispatch({ type: "event", sequence: event.sequence, payload: event.payload });
      void window.applePi.session.getSnapshot().then((snapshot) => dispatch({ type: "snapshot", snapshot })).catch(showError);
    });
  }, []);

  const applyWorkspace = (result: WorkspaceOpenResult | null) => {
    if (!result) return;
    if (result.catalog) setCatalog(result.catalog);
    setWorkspacePath(result.workspacePath);
    setSessions(result.sessions.map((session) => ({ ...session, persisted: true })));
    updateActiveSessionFromSnapshot(result.session);
    dispatch({ type: "snapshot", snapshot: result.session });
    void refreshSessions();
  };

  const snapshotOp = async (operation: Promise<SessionSnapshot>, label = "Updating session…"): Promise<void> => {
    setPendingLabel(label);
    setAppError("");
    setNotice("");
    try {
      const snapshot = await operation;
      dispatch({ type: "snapshot", snapshot });
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
      const result = path
        ? await window.applePi.workspace.select(path)
        : await window.applePi.workspace.pick();
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
      type: "snapshot",
      snapshot: {
        opened: true,
        sessionId: session.id,
        sessionFile: session.path,
        messages: [],
        running: false,
        model: catalog.defaultModel ? `${catalog.defaultModel.provider}/${catalog.defaultModel.modelId}` : state.model,
      },
    });
  };

  const openSession = async (session: UiSessionItem): Promise<void> => {
    setActiveSessionId(session.id);
    if (!session.persisted) {
      setDraftSessionId(session.id);
      dispatch({
        type: "snapshot",
        snapshot: {
          opened: true,
          sessionId: session.id,
          sessionFile: session.path,
          messages: [],
          running: false,
          model: catalog.defaultModel ? `${catalog.defaultModel.provider}/${catalog.defaultModel.modelId}` : state.model,
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
      await snapshotOp(window.applePi.session.send(text));
      return;
    }

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
      <a className="skip-link" href="#conversation">Skip to conversation</a>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">π</span><span>Apple Pi<small>Local agent</small></span></div>
        <button className="workspace" onClick={() => void openWorkspace()}><FolderInput size={17} /><span>Open Workspace</span><kbd>⌘O</kbd></button>
        <div className="section-title"><span>Workspaces</span><small>{catalog.workspaces.length}</small></div>
        <nav aria-label="Workspaces">
          {catalog.workspaces.map((workspace) => (
            <button
              key={workspace.path}
              title={workspace.path}
              className={workspacePath === workspace.path ? "selected" : ""}
              aria-current={workspacePath === workspace.path ? "page" : undefined}
              onClick={() => void openWorkspace(workspace.path)}
            >
              <span className="aside-icon"><Folder size={15} /> <span>{workspace.name}</span></span>
            </button>
          ))}
        </nav>
        {workspacePath && (
          <>
            <div className="sessions-head">
              <span>Sessions</span><small>{sessions.length}</small>
              <button aria-label="New session" title="New session" onClick={startDraftSession}><Plus size={14} /></button>
            </div>
            <nav className="sessions">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  className={activeSessionId === session.id ? "selected" : ""}
                  aria-current={activeSessionId === session.id ? "page" : undefined}
                  onClick={() => void openSession(session)}
                >
                  <span className="session-name"><MessageSquare size={13} />{session.persisted ? session.name : "Untitled session"}</span>
                  <small>{session.persisted ? `${session.messageCount} message${session.messageCount === 1 ? "" : "s"}` : "Draft · not saved"}</small>
                </button>
              ))}
            </nav>
          </>
        )}
        <div className="sidebar-footer">
          <span className="local-status"><i /> Running locally</span>
          <button className="settings-button" aria-pressed={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={15} /> Settings</button>
        </div>
      </aside>
      <main>
        <header>
          <div className="header-title">
            <span className="eyebrow">{settingsOpen ? "Preferences" : state.opened ? "Active session" : "Start here"}</span>
            <strong>{settingsOpen ? "Settings" : activeSessionId ? sessions.find((session) => session.id === activeSessionId)?.name ?? "New session" : "Welcome to Apple Pi"}</strong>
            <small title={workspacePath}>{workspacePath || "No workspace selected"}</small>
          </div>
          <div className="header-actions">
            {settingsOpen && <button className="icon-button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={17} /></button>}
            {state.running && <button className="cancel" onClick={() => void snapshotOp(window.applePi.session.cancel())}><Square size={11} fill="currentColor" /> Stop</button>}
          </div>
        </header>
        {settingsOpen ? (
          <section className="settings">
            <div className="settings-intro"><span className="settings-icon"><Settings2 size={22} /></span><div><h1>Make Apple Pi Yours</h1><p>Choose how new sessions begin. Changes are saved automatically.</p></div></div>
            <div className="settings-card">
              <div><h2>Default Model</h2><p>Used when you create a workspace or begin a new session. You can still switch models from the composer.</p></div>
              <div className="settings-control"><label htmlFor="default-model">Model</label><ModelSelect id="default-model" models={groupedModels} value={catalog.defaultModel ? modelKey(catalog.defaultModel) : ""} onChange={(value) => void changeDefaultModel(value)} emptyLabel="Use pi default" /></div>
            </div>
          </section>
        ) : (
          <>
            <section className="timeline" id="conversation" aria-label="Conversation" role="log" aria-live="polite" tabIndex={-1}>
              {!state.opened && <div className="empty"><div className="orb"><Sparkles size={26} /></div><span className="empty-kicker">PRIVATE · LOCAL · YOURS</span><h1>Build with an agent that lives on your Mac.</h1><p>Open a workspace to start a focused coding session. Your projects and transcripts stay on this machine.</p><button onClick={() => void openWorkspace()}><FolderInput size={17} /> Open a Workspace</button></div>}
              {state.messages.map((message, index) => {
                const text = textOf(message);
                return (
                  <article key={index} className={`message ${(message as { role?: string }).role ?? "event"}`}>
                    <header className="message-author"><span>{(message as { role?: string }).role === "user" ? "You" : "Pi"}</span></header>
                    <div className="message-content" dangerouslySetInnerHTML={markdownToHtml(text)} />
                  </article>
                );
              })}
              {state.error && <div className="error" role="alert">{state.error}</div>}
            </section>
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
                <div className="composer-bottom"><div className="model-select-wrap">{state.opened && !draftSessionId ? <Sparkles size={14} /> : <CircleDashed size={14} />}<ModelSelect ariaLabel="Session model" models={groupedModels} value={state.model?.replace("/", "::") ?? ""} onChange={(value) => void snapshotOp(window.applePi.model.setSession(parseModelKey(value)))} emptyLabel={state.opened ? "Default model" : "Select model"} disabled={!state.opened} /><ChevronDown size={13} className="select-chevron" /></div><span className="send-hint">↵ send · ⇧↵ new line</span></div>
              </div>
              <button aria-label="Send message" disabled={!state.opened || !draft.trim() || state.running} onClick={() => void send()} title="Send message">
                <Send size={16} />
              </button>
            </footer>
          </>
        )}
      </main>
      <div className="app-feedback" aria-live="polite" aria-atomic="true">
        {pendingLabel && <div className="app-status"><CircleDashed size={14} />{pendingLabel}</div>}
        {!pendingLabel && notice && <div className="app-status success">{notice}</div>}
        {appError && <div className="app-error" role="alert">{appError}</div>}
      </div>
    </div>
  );
}

function ModelSelect({
  id,
  ariaLabel,
  models,
  value,
  onChange,
  emptyLabel = "Select model",
  disabled = false,
}: {
  id?: string;
  ariaLabel?: string;
  models: Map<string, ModelItem[]>;
  value: string;
  onChange(value: string): void;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  return (
    <select id={id} aria-label={ariaLabel} className="model-select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="">{emptyLabel}</option>
      {[...models].map(([provider, items]) => (
        <optgroup key={provider} label={provider}>
          {items.map((model) => <option key={modelKey(model)} value={modelKey(model)}>{model.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
