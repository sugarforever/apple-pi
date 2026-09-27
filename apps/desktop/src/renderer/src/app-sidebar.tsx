import React, { useEffect, useId, useRef, useState } from "react";
import { Blocks, ChevronRight, Ellipsis, FolderInput, MessageSquare, Plus, Settings2 } from "lucide-react";
import type { Catalog } from "../global.js";
import type { UiSessionItem } from "../session-list.js";

type DisclosureIntent = "expand" | "collapse";

export function getWorkspaceDisclosureIntent(key: string, expanded: boolean): DisclosureIntent | undefined {
  if (key === "ArrowRight" && !expanded) return "expand";
  if ((key === "ArrowLeft" || key === "Escape") && expanded) return "collapse";
  return undefined;
}

function WorkspaceNavItem({
  workspace,
  selected,
  expanded,
  sessions,
  activeSessionId,
  onToggle,
  onOpenSkills,
  onStartSession,
  onOpenSession,
}: {
  workspace: Catalog["workspaces"][number];
  selected: boolean;
  expanded: boolean;
  sessions: UiSessionItem[];
  activeSessionId: string;
  onToggle(expanded: boolean): void;
  onOpenSkills(): void;
  onStartSession(): void;
  onOpenSession(session: UiSessionItem): void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const sessionListId = useId();
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

  const handleDisclosureKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const intent = getWorkspaceDisclosureIntent(event.key, expanded);
    if (!intent) return;
    event.preventDefault();
    onToggle(intent === "expand");
  };

  return (
    <div className="workspace-nav-item" ref={itemRef}>
      <div className="workspace-nav-row">
        <button
          title={workspace.path}
          className={`workspace-nav-button${selected ? " selected" : ""}`}
          aria-current={selected ? "page" : undefined}
          aria-expanded={expanded}
          aria-controls={sessionListId}
          onClick={() => onToggle(!expanded)}
          onKeyDown={handleDisclosureKeyDown}
        >
          <span>{workspace.name}</span>
          <ChevronRight className="workspace-chevron" size={13} aria-hidden="true" />
        </button>
        <div className="workspace-row-actions">
          {selected && !expanded && (
            <small className="workspace-session-count">
              {sessions.length}
              <span className="sr-only"> {sessions.length === 1 ? "session" : "sessions"}</span>
            </small>
          )}
          {selected && (
            <button aria-label={`New session in ${workspace.name}`} title="New session" onClick={onStartSession}>
              <Plus size={14} />
            </button>
          )}
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
        </div>
      </div>
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
      {expanded && selected && (
        <nav id={sessionListId} className="workspace-sessions" aria-label={`${workspace.name} sessions`}>
          {sessions.map((session) => (
            <button
              key={session.id}
              title={session.persisted ? session.name : "Untitled session"}
              className={activeSessionId === session.id ? "selected" : ""}
              aria-current={activeSessionId === session.id ? "page" : undefined}
              onClick={() => onOpenSession(session)}
            >
              <span className="session-name">
                <MessageSquare size={12} aria-hidden="true" />
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
  const [collapsedWorkspacePath, setCollapsedWorkspacePath] = useState("");

  const toggleWorkspace = (path: string, expanded: boolean) => {
    if (!expanded) {
      setCollapsedWorkspacePath(path);
      return;
    }
    setCollapsedWorkspacePath("");
    if (path !== props.workspacePath) props.onOpenWorkspace(path);
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
        <small>{props.catalog.workspaces.length}</small>
      </div>
      <div className="workspace-tree" role="navigation" aria-label="Workspaces">
        {props.catalog.workspaces.map((workspace) => {
          const selected = props.workspacePath === workspace.path;
          const expanded = selected && collapsedWorkspacePath !== workspace.path;
          return (
            <WorkspaceNavItem
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
