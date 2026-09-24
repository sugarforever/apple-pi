import React, { useEffect, useRef, useState } from "react";
import { Blocks, Ellipsis, Folder, FolderInput, MessageSquare, Plus, Settings2 } from "lucide-react";
import type { Catalog } from "../global.js";
import type { UiSessionItem } from "../session-list.js";

function WorkspaceNavItem({
  workspace,
  selected,
  onOpen,
  onOpenSkills,
}: {
  workspace: Catalog["workspaces"][number];
  selected: boolean;
  onOpen: () => void;
  onOpenSkills: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    firstMenuItemRef.current?.focus();

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!itemRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuTriggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <div className="workspace-nav-item" ref={itemRef}>
      <button
        title={workspace.path}
        className={`workspace-nav-button${selected ? " selected" : ""}`}
        aria-current={selected ? "page" : undefined}
        onClick={onOpen}
      >
        <span className="aside-icon">
          <Folder size={14} /> <span>{workspace.name}</span>
        </span>
      </button>
      <button
        ref={menuTriggerRef}
        className="workspace-menu-trigger"
        aria-label={`More actions for ${workspace.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Ellipsis size={15} />
      </button>
      {menuOpen && (
        <div className="workspace-menu" role="menu" aria-label={`${workspace.name} actions`}>
          <button
            ref={firstMenuItemRef}
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onOpenSkills();
            }}
          >
            <Blocks size={14} /> Skills
          </button>
        </div>
      )}
    </div>
  );
}

export function AppSidebar(props: {
  catalog: Catalog;
  workspacePath: string;
  sessions: UiSessionItem[];
  activeSessionId: string;
  settingsOpen: boolean;
  onOpenWorkspace(path?: string, view?: "conversation" | "skills"): void;
  onStartSession(): void;
  onOpenSession(session: UiSessionItem): void;
  onToggleSettings(): void;
}) {
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
        <small>{props.catalog.workspaces.length}</small>
      </div>
      <nav aria-label="Workspaces">
        {props.catalog.workspaces.map((workspace) => (
          <WorkspaceNavItem
            key={workspace.path}
            workspace={workspace}
            selected={props.workspacePath === workspace.path}
            onOpen={() => props.onOpenWorkspace(workspace.path)}
            onOpenSkills={() => props.onOpenWorkspace(workspace.path, "skills")}
          />
        ))}
      </nav>
      {props.workspacePath && (
        <>
          <div className="sessions-head">
            <span>Sessions</span>
            <small>{props.sessions.length}</small>
            <button aria-label="New session" title="New session" onClick={props.onStartSession}>
              <Plus size={14} />
            </button>
          </div>
          <nav className="sessions" aria-label="Sessions">
            {props.sessions.map((session) => (
              <button
                key={session.id}
                className={props.activeSessionId === session.id ? "selected" : ""}
                aria-current={props.activeSessionId === session.id ? "page" : undefined}
                onClick={() => props.onOpenSession(session)}
              >
                <span className="session-name">
                  <MessageSquare size={12} />
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
        </>
      )}
      <div className="sidebar-footer">
        <button className="settings-button" aria-pressed={props.settingsOpen} onClick={props.onToggleSettings}>
          <Settings2 size={14} /> Settings
        </button>
      </div>
    </aside>
  );
}
