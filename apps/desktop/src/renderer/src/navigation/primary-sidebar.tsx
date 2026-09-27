import React, { useState } from "react";
import { FolderInput, Settings2 } from "lucide-react";
import type { Catalog } from "../../global.js";
import type { UiSessionItem } from "../../session-list.js";
import { WorkspaceRow } from "./workspace-row.js";
import "./navigation.css";

export interface PrimarySidebarProps {
  workspaces: Catalog["workspaces"];
  workspacePath: string;
  sessions: UiSessionItem[];
  activeSessionId: string;
  settingsOpen: boolean;
  onOpenWorkspace(path?: string, view?: "conversation" | "skills"): void;
  onStartSession(): void;
  onOpenSession(session: UiSessionItem): void;
  onToggleSettings(): void;
}

export function PrimarySidebar(props: PrimarySidebarProps) {
  const [collapsedWorkspacePath, setCollapsedWorkspacePath] = useState("");

  const toggleWorkspace = (path: string, expanded: boolean) => {
    applyWorkspaceToggle(path, props.workspacePath, expanded, setCollapsedWorkspacePath, props.onOpenWorkspace);
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">π</span>
        <span>Apple Pi</span>
      </div>
      <button className="workspace" onClick={() => props.onOpenWorkspace()}>
        <FolderInput size={16} />
        <span>Open Workspace</span>
        <kbd>⌘O</kbd>
      </button>
      <div className="section-title">
        <span>Workspaces</span>
        <small>{props.workspaces.length}</small>
      </div>
      <div className="workspace-tree" role="navigation" aria-label="Workspaces">
        {props.workspaces.map((workspace) => {
          const selected = props.workspacePath === workspace.path;
          const expanded = selected && collapsedWorkspacePath !== workspace.path;
          return (
            <WorkspaceRow
              key={workspace.path}
              workspace={workspace}
              selected={selected}
              expanded={expanded}
              sessions={selected ? props.sessions : []}
              activeSessionId={selected ? props.activeSessionId : ""}
              onToggle={(nextExpanded) => toggleWorkspace(workspace.path, nextExpanded)}
              onOpenSkills={() => props.onOpenWorkspace(workspace.path, "skills")}
              onStartSession={props.onStartSession}
              onOpenSession={props.onOpenSession}
            />
          );
        })}
      </div>
      <div className="sidebar-footer">
        <button className="settings-button" aria-pressed={props.settingsOpen} onClick={props.onToggleSettings}>
          <Settings2 size={14} /> Settings
        </button>
      </div>
    </aside>
  );
}

export function applyWorkspaceToggle(
  path: string,
  currentPath: string,
  expanded: boolean,
  setCollapsedPath: (path: string) => void,
  openWorkspace: (path: string) => void,
): void {
  if (!expanded) {
    setCollapsedPath(path);
    return;
  }
  setCollapsedPath("");
  if (path !== currentPath) openWorkspace(path);
}
