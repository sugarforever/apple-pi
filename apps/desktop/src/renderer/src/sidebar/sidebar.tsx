import React from "react";
import { Folder, FolderOpen, FolderPlus, SquarePen } from "lucide-react";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { Workspace } from "../../../shared/pi-api.js";
import "./sidebar.css";

export interface SidebarProps {
  workspaces: Workspace[];
  workspace?: string;
  sessions: SessionInfo[];
  activeSessionFile?: string;
  onNewChat(): void;
  onAddWorkspace(): void;
  onSelectWorkspace(path: string): void;
  onSelectSession(file: string): void;
}

/** Temporary navigation: projects and their Pi sessions. */
export function Sidebar(props: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Projects and chats">
      <button type="button" className="sidebar-item" onClick={props.onNewChat} disabled={!props.workspace}>
        <SquarePen size={16} aria-hidden />
        <span>New chat</span>
      </button>
      <div className="sidebar-heading">
        <span>Projects</span>
        <button type="button" className="icon-button" onClick={props.onAddWorkspace} aria-label="Add project folder" title="Add project folder">
          <FolderPlus size={16} />
        </button>
      </div>
      <ul className="sidebar-list">
        {props.workspaces.map((item) => {
          const selected = item.path === props.workspace;
          const Icon = selected ? FolderOpen : Folder;
          return (
            <li key={item.path}>
              <button
                type="button"
                className="sidebar-item"
                aria-current={selected ? "true" : undefined}
                title={item.path}
                onClick={() => props.onSelectWorkspace(item.path)}
              >
                <Icon size={16} aria-hidden />
                <span>{item.name}</span>
              </button>
              {selected && props.sessions.length > 0 && (
                <ul className="sidebar-list sidebar-sessions">
                  {props.sessions.map((session) => (
                    <li key={session.path}>
                      <button
                        type="button"
                        className="sidebar-item"
                        aria-current={session.path === props.activeSessionFile ? "page" : undefined}
                        onClick={() => props.onSelectSession(session.path)}
                      >
                        <span>{session.name || session.firstMessage || "Untitled chat"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
