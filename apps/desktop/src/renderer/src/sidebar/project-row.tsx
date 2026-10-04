import React, { useState } from "react";
import { Folder, FolderOpen, Trash2 } from "lucide-react";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { Workspace } from "../../../shared/pi-api.js";
import type { ChatIndicator } from "./activity.js";
import { ChatRow } from "./chat-row.js";
import { sessionTitle } from "./chats.js";
import { RowMenu } from "./row-menu.js";

/** Chats listed before "Show more". */
const VISIBLE_CHATS = 5;

export interface ProjectRowProps {
  workspace: Workspace;
  open: boolean;
  /** This project's chats to list, newest first; undefined while loading. */
  chats?: SessionInfo[];
  /** Lists every chat at once, as search does. */
  showAll?: boolean;
  activeSessionFile?: string;
  indicator(sessionFile: string): ChatIndicator | undefined;
  onToggle(): void;
  onRemove(): void;
  onSelectChat(sessionFile: string): void;
  onRenameChat(session: SessionInfo, name: string): void;
}

/** A project folder and, while open, its chats. */
export function ProjectRow(props: ProjectRowProps) {
  const { workspace, open, chats = [], activeSessionFile } = props;
  const [expandedList, setExpandedList] = useState(false);
  // Keep the open chat in view even when it is older than the first few.
  const activeIndex = chats.findIndex((session) => session.path === activeSessionFile);
  const limit = props.showAll || expandedList ? chats.length : Math.max(VISIBLE_CHATS, activeIndex + 1);
  const Icon = open ? FolderOpen : Folder;

  return (
    <li className="project">
      <div className="project-row">
        <button type="button" className="sidebar-item" aria-expanded={open} title={workspace.path} onClick={props.onToggle}>
          <Icon size={16} className="sidebar-icon" aria-hidden />
          <span className="sidebar-label">{workspace.name}</span>
        </button>
        <RowMenu
          label={`${workspace.name} actions`}
          items={[{ key: "remove", label: "Remove project", icon: <Trash2 size={14} />, danger: true, onSelect: props.onRemove }]}
        />
      </div>
      {open && chats.length > 0 && (
        <ul className="sidebar-list project-chats">
          {chats.slice(0, limit).map((session) => (
            <ChatRow
              key={session.path}
              title={sessionTitle(session)}
              active={session.path === activeSessionFile}
              indicator={props.indicator(session.path)}
              onSelect={() => props.onSelectChat(session.path)}
              onRename={(name) => props.onRenameChat(session, name)}
            />
          ))}
          {chats.length > limit && (
            <li>
              <button type="button" className="sidebar-item show-more" onClick={() => setExpandedList(true)}>
                <span className="sidebar-label">Show more</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
