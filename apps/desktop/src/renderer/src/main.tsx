import React, { useEffect, useMemo, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import { CircleDashed, Plus, Send, Settings2, Sparkles, FolderInput, ChevronDown } from "lucide-react";
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

  const groupedModels = useMemo(() => {
    return models.reduce((groups, model) => {
      groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
      return groups;
    }, new Map<string, ModelItem[]>());
  }, [models]);

  const showError = (error: unknown) =>
    dispatch({ type: "error", error: error instanceof Error ? error.message : String(error) });

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

  const snapshotOp = async (operation: Promise<SessionSnapshot>): Promise<void> => {
    try {
      const snapshot = await operation;
      dispatch({ type: "snapshot", snapshot });
      updateActiveSessionFromSnapshot(snapshot);
      await refreshSessions();
    } catch (error) {
      showError(error);
    }
  };

  const openWorkspace = async (path?: string): Promise<void> => {
    try {
      const result = path
        ? await window.applePi.workspace.select(path)
        : await window.applePi.workspace.pick();
      applyWorkspace(result);
    } catch (error) {
      showError(error);
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
    await snapshotOp(window.applePi.session.select(session.path));
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
    try {
      setCatalog(await window.applePi.model.setDefault(parseModelKey(value)));
    } catch (error) {
      showError(error);
    }
  };

  return (
    <div className="shell">
      <aside>
        <div className="brand"><span>π</span> Apple Pi</div>
        <button className="workspace" onClick={() => void openWorkspace()}><FolderInput size={15} /> Add workspace</button>
        <div className="section-title">WORKSPACES</div>
        <nav>
          {catalog.workspaces.map((workspace) => (
            <button
              key={workspace.path}
              title={workspace.path}
              className={workspacePath === workspace.path ? "selected" : ""}
              onClick={() => void openWorkspace(workspace.path)}
            >
              <span className="aside-icon"><FolderInput size={15} /> <span>{workspace.name}</span></span>
            </button>
          ))}
        </nav>
        {workspacePath && (
          <>
            <div className="sessions-head">
              <span>SESSIONS</span>
              <button title="New session" onClick={startDraftSession}><Plus size={14} /></button>
            </div>
            <nav className="sessions">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  className={activeSessionId === session.id ? "selected" : ""}
                  onClick={() => void openSession(session)}
                >
                  <span>{session.persisted ? session.name : "Draft session"}</span>
                  <small>{session.persisted ? `${session.messageCount} messages` : "Not saved yet"}</small>
                </button>
              ))}
            </nav>
          </>
        )}
        <button className="settings-button" onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={14} /> Settings</button>
      </aside>
      <main>
        <header>
          <div>
            <strong>{state.opened ? "Current session" : "Welcome"}</strong>
            <small>{workspacePath || "Select a project to begin"}</small>
          </div>
          <div className="header-actions">
            {state.running && <button className="cancel" onClick={() => void snapshotOp(window.applePi.session.cancel())}>Stop</button>}
          </div>
        </header>
        {settingsOpen ? (
          <section className="settings">
            <h1>Settings</h1>
            <h2>Default model</h2>
            <p>New workspaces and sessions inherit this model. Override it for the current session from the chat header.</p>
            <ModelSelect
              models={groupedModels}
              value={catalog.defaultModel ? modelKey(catalog.defaultModel) : ""}
              onChange={(value) => void changeDefaultModel(value)}
              emptyLabel="Use pi default"
            />
          </section>
        ) : (
          <>
            <section className="timeline">
              {!state.opened && <div className="empty"><div className="orb">π</div><h1>Your local pi desktop</h1><p>Add or select a workspace, then open a session or start a new one.</p></div>}
              {state.messages.map((message, index) => {
                const text = textOf(message);
                return (
                  <article key={index} className={`message ${(message as { role?: string }).role ?? "event"}`}>
                    <label>{(message as { role?: string }).role ?? "event"}</label>
                    <div className="message-content" dangerouslySetInnerHTML={markdownToHtml(text)} />
                  </article>
                );
              })}
              {state.error && <div className="error">{state.error}</div>}
            </section>
            <footer>
              <div className="input-toolbar">
                <div className="model-select-wrap">
                  {state.opened && !draftSessionId ? <Sparkles size={14} /> : <CircleDashed size={14} />}
                  <ModelSelect
                    models={groupedModels}
                    value={state.model?.replace("/", "::") ?? ""}
                    onChange={(value) => void snapshotOp(window.applePi.model.setSession(parseModelKey(value)))}
                    emptyLabel={state.opened ? "Default for model" : "Select model"}
                    disabled={!state.opened}
                  />
                  <ChevronDown size={14} className="select-chevron" />
                </div>
                <textarea
                  disabled={!state.opened || state.running}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={state.opened ? "Ask pi anything…" : "Select a workspace first"}
                />
              </div>
              <button disabled={!state.opened || !draft.trim() || state.running} onClick={() => void send()} title="Send message">
                <Send size={16} />
              </button>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

function ModelSelect({
  models,
  value,
  onChange,
  emptyLabel = "Select model",
  disabled = false,
}: {
  models: Map<string, ModelItem[]>;
  value: string;
  onChange(value: string): void;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  return (
    <select className="model-select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
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
