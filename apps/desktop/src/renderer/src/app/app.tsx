import React, { useCallback, useEffect, useRef, useState } from "react";
import { Folder, FolderPlus, Settings } from "lucide-react";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { SettingsView } from "../settings/settings-view.js";
import { APP_VERSION, PI_VERSION } from "../settings/versions.js";
import { ConversationMenu } from "../shell/conversation-menu.js";
import { IconRail, type ShellView } from "../shell/icon-rail.js";
import { Shell } from "../shell/shell.js";
import { TitleBar } from "../shell/title-bar.js";
import { chatIndicator } from "../sidebar/activity.js";
import { adjacentChat, nestChats } from "../sidebar/chats.js";
import { Sidebar } from "../sidebar/sidebar.js";
import { useActivity } from "../sidebar/use-activity.js";
import { useWorkspaces } from "../sidebar/use-workspaces.js";
import { Conversation, type ConversationHandle } from "./conversation.js";
import { useAppCommands } from "./use-app-commands.js";

/** Which conversation is on screen. `id` changes only when the user picks another chat. */
interface Chat {
  id: string;
  workspace: string;
  sessionFile?: string;
  /** Started in this window rather than picked from the sidebar. */
  isNew: boolean;
  /** Composer text to start with, such as the message a fork was taken from. */
  draft?: string;
}

let nextChat = 0;
const newChat = (workspace: string): Chat => ({ id: `new-${++nextChat}`, workspace, isNew: true });

export function App() {
  const [error, setError] = useState("");
  const report = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)), []);
  const projects = useWorkspaces(report);
  const activity = useActivity();
  const [view, setView] = useState<ShellView>("chats");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chat, setChat] = useState<Chat>();
  const [title, setTitle] = useState("");
  const conversation = useRef<ConversationHandle>(null);
  const workspaces = projects.workspaces ?? [];

  // Open a new chat in the first project once the list arrives.
  const firstWorkspace = projects.workspaces?.[0]?.path;
  const [started, setStarted] = useState(false);
  if (!started && firstWorkspace) {
    setStarted(true);
    setChat(newChat(firstWorkspace));
  }

  const { view: markViewed } = activity;
  const visibleFile = view === "chats" ? chat?.sessionFile : undefined;
  useEffect(() => markViewed(visibleFile), [markViewed, visibleFile]);

  const startChat = async (workspace = chat?.workspace ?? firstWorkspace) => {
    const target = workspace ?? (await projects.add())?.path;
    if (!target) return;
    setView("chats");
    setChat(newChat(target));
  };

  const openChat = (workspace: string, sessionFile: string) => {
    setView("chats");
    if (chat?.sessionFile === sessionFile) return;
    setChat({ id: sessionFile, workspace, sessionFile, isNew: false });
  };

  /** Opens the fork or copy a conversation's process now writes; the same process serves it. */
  const openBranch = (workspace: string, sessionFile: string, draft?: string) => {
    setView("chats");
    setChat({ id: sessionFile, workspace, sessionFile, isNew: false, draft });
    projects.setExpanded(workspace, true);
  };

  const addProject = async () => {
    const added = await projects.add();
    if (added) await startChat(added.path);
  };

  const removeProject = async (workspace: string) => {
    await projects.remove(workspace);
    if (chat?.workspace !== workspace) return;
    const next = workspaces.find((item) => item.path !== workspace);
    setChat(next ? newChat(next.path) : undefined);
  };

  /** Names the session through Pi, borrowing a process when the chat is not live. */
  const renameChat = async (workspace: string, session: SessionInfo, name: string) => {
    if (chat?.sessionFile === session.path && conversation.current) {
      await conversation.current.request({ type: "set_session_name", name });
    } else {
      const running = chatIndicator(activity.state, session.path) === "running";
      const sessionKey = await window.applePi.pi.open({ workspace, sessionFile: session.path });
      try {
        const response = await window.applePi.pi.send(sessionKey, { type: "set_session_name", name });
        if (!response.success) throw new Error(response.error);
      } finally {
        // Nothing is on screen for it, so an idle process has no reason to stay.
        if (!running) await window.applePi.pi.close(sessionKey);
      }
    }
    projects.refresh(workspace);
  };

  const { refresh, setExpanded } = projects;
  const { attach } = activity;
  const chatWorkspace = chat?.workspace;
  const onSessionFile = useCallback(
    (chatId: string, sessionFile: string, sessionKey: string) => {
      attach(sessionKey, sessionFile);
      // The chat keeps its id, so the conversation stays mounted as it gains a file.
      setChat((current) => (current?.id === chatId && current.sessionFile !== sessionFile ? { ...current, sessionFile } : current));
    },
    [attach],
  );
  const onSettled = useCallback(() => {
    if (!chatWorkspace) return;
    // A first prompt makes the session file; show the project's chats so it appears.
    setExpanded(chatWorkspace, true);
    refresh(chatWorkspace);
  }, [chatWorkspace, refresh, setExpanded]);

  const [searchRequest, setSearchRequest] = useState(0);
  const toggleSidebar = () => {
    setSidebarOpen((open) => !open);
    // A sidebar shown again starts with search closed, whatever opened it last time.
    setSearchRequest(0);
  };

  /** Moves through the chats the sidebar lists, in its order. */
  const stepChat = (step: 1 | -1) => {
    const listed = workspaces
      .filter((item) => projects.expanded.has(item.path))
      .map((item) => ({ workspace: item.path, chats: nestChats(projects.sessions[item.path] ?? []).map(({ session }) => session) }));
    const next = adjacentChat(listed, chat?.sessionFile, step);
    if (next) openChat(next.workspace, next.sessionFile);
  };

  useAppCommands({
    "new-chat": () => void startChat().catch(report),
    "add-project": () => void addProject().catch(report),
    "open-settings": () => setView("settings"),
    "toggle-sidebar": toggleSidebar,
    "search-chats": () => {
      setSidebarOpen(true);
      setSearchRequest((count) => count + 1);
      projects.refreshAll();
    },
    "previous-chat": () => stepChat(-1),
    "next-chat": () => stepChat(1),
  });

  const current = workspaces.find((item) => item.path === chat?.workspace);
  const settings = view === "settings";

  const titleBar = settings ? (
    <TitleBar sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} icon={<Settings size={16} />} title="Settings" />
  ) : (
    <TitleBar
      sidebarOpen={sidebarOpen}
      onToggleSidebar={toggleSidebar}
      icon={current && <Folder size={16} />}
      title={current && (title || "New chat")}
      detail={current && `${current.name} · ${current.path}`}
      actions={
        current && (
          <ConversationMenu
            workspace={current.path}
            sessionFile={chat?.sessionFile}
            loadStats={async () => (await conversation.current!.request({ type: "get_session_stats" })).data}
            compact={async () => {
              await conversation.current?.request({ type: "compact" });
            }}
            duplicate={chat?.sessionFile ? () => conversation.current!.duplicate() : undefined}
            onError={report}
          />
        )
      }
    />
  );

  return (
    <Shell
      titleBar={titleBar}
      rail={<IconRail view={view} onSelect={setView} />}
      sidebar={
        sidebarOpen && (
          <Sidebar
            workspaces={workspaces}
            sessions={projects.sessions}
            expanded={projects.expanded}
            activeSessionFile={settings ? undefined : chat?.sessionFile}
            indicator={(sessionFile) => chatIndicator(activity.state, sessionFile)}
            onNewChat={() => void startChat().catch(report)}
            onAddProject={() => void addProject().catch(report)}
            onToggleProject={projects.setExpanded}
            onRemoveProject={(workspace) => void removeProject(workspace).catch(report)}
            onSelectChat={openChat}
            onRenameChat={(workspace, session, name) => void renameChat(workspace, session, name).catch(report)}
            onSearch={projects.refreshAll}
            searchRequest={searchRequest}
          />
        )
      }
    >
      {settings ? (
        <SettingsView piVersion={PI_VERSION} appVersion={APP_VERSION} onOpenSettingsFile={() => void window.applePi.shell.openSettingsFile().catch(report)} />
      ) : !projects.workspaces ? (
        <main className="conversation" />
      ) : current && chat ? (
        <Conversation
          key={`${chat.workspace}:${chat.id}`}
          ref={conversation}
          workspace={current.path}
          workspaceName={current.name}
          sessionFile={chat.sessionFile}
          isNew={chat.isNew}
          initialDraft={chat.draft}
          onTitle={setTitle}
          onBranch={(sessionFile, draft) => openBranch(current.path, sessionFile, draft)}
          onError={report}
          onSessionFile={(sessionFile, sessionKey) => onSessionFile(chat.id, sessionFile, sessionKey)}
          onSettled={onSettled}
        />
      ) : (
        <main className="conversation conversation-welcome">
          <h1 className="conversation-empty">Add a project folder to start working with Pi.</h1>
          <button type="button" className="welcome-button" onClick={() => void addProject().catch(report)}>
            <FolderPlus size={16} aria-hidden />
            Add project folder
          </button>
        </main>
      )}
      {error && (
        <div className="app-error" role="alert">
          <button type="button" className="app-error-dismiss" title="Dismiss" onClick={() => setError("")}>
            {error}
            <span className="sr-only">, dismiss</span>
          </button>
        </div>
      )}
    </Shell>
  );
}
