import React, { useState } from "react";
import { FolderPlus, Search, SquarePen, X } from "lucide-react";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { Workspace } from "../../../shared/pi-api.js";
import type { ChatIndicator } from "./activity.js";
import { matchesQuery, sessionTitle } from "./chats.js";
import { ProjectRow } from "./project-row.js";
import "./sidebar.css";

export interface SidebarProps {
  workspaces: Workspace[];
  /** Pi's sessions per workspace, newest first. */
  sessions: Readonly<Record<string, SessionInfo[]>>;
  expanded: ReadonlySet<string>;
  activeSessionFile?: string;
  indicator(sessionFile: string): ChatIndicator | undefined;
  onNewChat(): void;
  onAddProject(): void;
  onToggleProject(workspace: string, open: boolean): void;
  onRemoveProject(workspace: string): void;
  onSelectChat(workspace: string, sessionFile: string): void;
  onRenameChat(workspace: string, session: SessionInfo, name: string): void;
  /** Called when search opens, so every project's chats can be loaded. */
  onSearch?(): void;
  /** Starting query, for visual fixtures. */
  initialQuery?: string;
}

/** Projects and their chats, with new chat and search at the top. */
export function Sidebar(props: SidebarProps) {
  // Undefined while the search field is closed.
  const [query, setQuery] = useState<string | undefined>(props.initialQuery);
  const searching = Boolean(query?.trim());
  const projects = props.workspaces.map((workspace) => {
    const all = props.sessions[workspace.path];
    return { workspace, chats: searching ? all?.filter((session) => matchesQuery(sessionTitle(session), query!)) : all };
  });

  const openSearch = () => {
    setQuery("");
    props.onSearch?.();
  };

  return (
    <nav className="sidebar" aria-label="Projects and chats">
      <div className="sidebar-header">
        <span className="sidebar-app-name">Apple Pi Lite</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Search chats"
          title="Search chats"
          aria-pressed={query !== undefined}
          onClick={() => (query === undefined ? openSearch() : setQuery(undefined))}
        >
          <Search size={17} />
        </button>
      </div>
      {query !== undefined && (
        <div className="sidebar-search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search chats"
            aria-label="Search chats"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && setQuery(undefined)}
          />
          <button type="button" className="icon-button" aria-label="Close search" onClick={() => setQuery(undefined)}>
            <X size={14} />
          </button>
        </div>
      )}
      <button type="button" className="sidebar-item new-chat" onClick={props.onNewChat}>
        <SquarePen size={16} className="sidebar-icon" aria-hidden />
        <span className="sidebar-label">New chat</span>
      </button>
      <div className="sidebar-heading">
        <span>Projects</span>
        <button type="button" className="icon-button" onClick={props.onAddProject} aria-label="Add project folder" title="Add project folder">
          <FolderPlus size={15} />
        </button>
      </div>
      <ul className="sidebar-list">
        {projects.map(({ workspace, chats }) => {
          if (searching && !chats?.length) return null;
          const open = searching || props.expanded.has(workspace.path);
          return (
            <ProjectRow
              key={workspace.path}
              workspace={workspace}
              open={open}
              chats={chats}
              showAll={searching}
              activeSessionFile={props.activeSessionFile}
              indicator={props.indicator}
              onToggle={() => props.onToggleProject(workspace.path, !open)}
              onRemove={() => props.onRemoveProject(workspace.path)}
              onSelectChat={(sessionFile) => props.onSelectChat(workspace.path, sessionFile)}
              onRenameChat={(session, name) => props.onRenameChat(workspace.path, session, name)}
            />
          );
        })}
      </ul>
      {searching && projects.every(({ chats }) => !chats?.length) && <p className="sidebar-empty">No chats match “{query!.trim()}”</p>}
      {props.workspaces.length === 0 && <p className="sidebar-empty">Add a project folder to start.</p>}
    </nav>
  );
}
