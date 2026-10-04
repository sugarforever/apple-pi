import React, { useCallback, useEffect, useState } from "react";
import { FolderPlus } from "lucide-react";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { Workspace } from "../../../shared/pi-api.js";
import { Sidebar } from "../sidebar/sidebar.js";
import { Conversation } from "./conversation.js";

/** Which conversation is on screen. `id` changes only when the user picks another chat. */
interface Chat {
  id: string;
  sessionFile?: string;
}

let nextChat = 0;
const newChat = (): Chat => ({ id: `new-${++nextChat}` });

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<string>();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [chat, setChat] = useState<Chat>(newChat);
  const [error, setError] = useState("");

  const report = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)), []);

  useEffect(() => {
    window.applePi.workspaces
      .list()
      .then((items) => {
        setWorkspaces(items);
        setWorkspace((current) => current ?? items[0]?.path);
      })
      .catch(report);
  }, [report]);

  const refreshSessions = useCallback(() => {
    if (!workspace) return;
    window.applePi.sessions
      .list(workspace)
      .then((items) => setSessions([...items].sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())))
      .catch(report);
  }, [report, workspace]);

  useEffect(refreshSessions, [refreshSessions]);

  const addWorkspace = async () => {
    const added = await window.applePi.workspaces.pick();
    if (!added) return;
    setWorkspaces(await window.applePi.workspaces.list());
    selectWorkspace(added.path);
  };

  const selectWorkspace = (path: string) => {
    setSessions([]);
    setWorkspace(path);
    setChat(newChat());
  };

  const current = workspaces.find((item) => item.path === workspace);

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        workspace={workspace}
        sessions={sessions}
        activeSessionFile={chat.sessionFile}
        onNewChat={() => setChat(newChat())}
        onAddWorkspace={() => void addWorkspace().catch(report)}
        onSelectWorkspace={selectWorkspace}
        onSelectSession={(sessionFile) => setChat({ id: sessionFile, sessionFile })}
      />
      {current ? (
        <Conversation
          key={`${current.path}:${chat.id}`}
          workspace={current.path}
          workspaceName={current.name}
          sessionFile={chat.sessionFile}
          onSessionFile={(sessionFile) => setChat((value) => (value.id === chat.id ? { ...value, sessionFile } : value))}
          onSettled={refreshSessions}
        />
      ) : (
        <main className="conversation conversation-welcome">
          <h1 className="conversation-empty">Add a project folder to start working with Pi.</h1>
          <button type="button" className="welcome-button" onClick={() => void addWorkspace().catch(report)}>
            <FolderPlus size={16} aria-hidden />
            Add project folder
          </button>
        </main>
      )}
      {error && (
        <div className="app-error" role="alert" onClick={() => setError("")}>
          {error}
        </div>
      )}
    </div>
  );
}
