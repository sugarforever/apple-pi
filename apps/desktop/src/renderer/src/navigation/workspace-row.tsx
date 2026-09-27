import React, { useEffect, useId, useRef, useState } from "react";
import { Blocks, ChevronRight, Ellipsis, Plus } from "lucide-react";
import type { Catalog } from "../../global.js";
import type { UiSessionItem } from "../../session-list.js";
import { SessionList } from "./session-list.js";

type DisclosureIntent = "expand" | "collapse";

export function getWorkspaceDisclosureIntent(key: string, expanded: boolean): DisclosureIntent | undefined {
  if (key === "ArrowRight" && !expanded) return "expand";
  if ((key === "ArrowLeft" || key === "Escape") && expanded) return "collapse";
  return undefined;
}

export function closeWorkspaceMenu(close: () => void, trigger: Pick<HTMLButtonElement, "focus"> | null): void {
  close();
  trigger?.focus();
}

export interface WorkspaceRowProps {
  workspace: Catalog["workspaces"][number];
  selected: boolean;
  expanded: boolean;
  sessions: UiSessionItem[];
  activeSessionId: string;
  onToggle(expanded: boolean): void;
  onOpenSkills(): void;
  onStartSession(): void;
  onOpenSession(session: UiSessionItem): void;
}

export function WorkspaceRow(props: WorkspaceRowProps) {
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
      closeWorkspaceMenu(() => setMenuOpen(false), menuTriggerRef.current);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const handleDisclosureKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const intent = getWorkspaceDisclosureIntent(event.key, props.expanded);
    if (!intent) return;
    event.preventDefault();
    props.onToggle(intent === "expand");
  };

  return (
    <div className="workspace-nav-item" ref={itemRef}>
      <div className="workspace-nav-row">
        <button
          title={props.workspace.path}
          className={`workspace-nav-button${props.selected ? " selected" : ""}`}
          aria-current={props.selected ? "page" : undefined}
          aria-expanded={props.expanded}
          aria-controls={sessionListId}
          onClick={() => props.onToggle(!props.expanded)}
          onKeyDown={handleDisclosureKeyDown}
        >
          <span>{props.workspace.name}</span>
          <ChevronRight className="workspace-chevron" size={13} aria-hidden="true" />
        </button>
        <div className="workspace-row-actions">
          {props.selected && !props.expanded && (
            <small className="workspace-session-count">
              {props.sessions.length}
              <span className="sr-only"> {props.sessions.length === 1 ? "session" : "sessions"}</span>
            </small>
          )}
          {props.selected && (
            <button aria-label={`New session in ${props.workspace.name}`} title="New session" onClick={props.onStartSession}>
              <Plus size={14} />
            </button>
          )}
          <button
            ref={menuTriggerRef}
            className="workspace-menu-trigger"
            aria-label={`More actions for ${props.workspace.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Ellipsis size={15} />
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="workspace-menu" role="menu" aria-label={`${props.workspace.name} actions`}>
          <button
            ref={firstMenuItemRef}
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              props.onOpenSkills();
            }}
          >
            <Blocks size={14} /> Skills
          </button>
        </div>
      )}
      {props.expanded && props.selected && (
        <SessionList
          id={sessionListId}
          workspaceName={props.workspace.name}
          sessions={props.sessions}
          activeSessionId={props.activeSessionId}
          onOpenSession={props.onOpenSession}
        />
      )}
    </div>
  );
}
