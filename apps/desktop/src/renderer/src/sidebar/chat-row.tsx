import React, { useEffect, useRef, useState } from "react";
import { GitBranch, Pencil } from "lucide-react";
import type { ChatIndicator } from "./activity.js";
import { RowMenu } from "./row-menu.js";

export interface ChatRowProps {
  title: string;
  active: boolean;
  /** How deep in a fork family the chat sits; 0 for a chat of its own. */
  depth?: number;
  indicator?: ChatIndicator;
  onSelect(): void;
  onRename(name: string): void;
}

const INDICATOR_LABEL: Record<ChatIndicator, string> = { running: "Running", unread: "Finished, unread" };

/** One saved chat under its project: title, run indicator, and a rename action. */
export function ChatRow({ title, active, depth = 0, indicator, onSelect, onRename }: ChatRowProps) {
  const [editing, setEditing] = useState(false);
  const item = useRef<HTMLButtonElement>(null);
  const renamed = useRef(false);
  useEffect(() => {
    if (editing || !renamed.current) return;
    renamed.current = false;
    item.current?.focus();
  }, [editing]);

  // Deeper forks stop indenting after a couple of levels so titles keep their room.
  const nesting = depth > 0 ? ({ "--chat-depth": Math.min(depth, 2) } as React.CSSProperties) : undefined;

  if (editing) {
    const finish = (value: string | undefined) => {
      setEditing(false);
      const name = value?.trim();
      if (name && name !== title) onRename(name);
    };
    return (
      <li className="chat-row" style={nesting}>
        <input
          className="chat-rename"
          aria-label="Chat name"
          defaultValue={title}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => finish(event.currentTarget.value)}
          onKeyDown={(event) => {
            // A rename ended from the keyboard returns focus to the row; a click elsewhere keeps its own focus.
            if (event.key === "Enter" || event.key === "Escape") renamed.current = true;
            if (event.key === "Enter") finish(event.currentTarget.value);
            else if (event.key === "Escape") finish(undefined);
          }}
        />
      </li>
    );
  }

  return (
    <li className="chat-row" data-indicator={indicator} data-nested={depth > 0 || undefined} style={nesting}>
      <button ref={item} type="button" className="sidebar-item chat-item" aria-current={active ? "page" : undefined} title={title} onClick={onSelect}>
        {depth > 0 && <GitBranch size={13} className="chat-branch-icon" aria-hidden />}
        <span className="sidebar-label">{title}</span>
        {/* The indicator is drawn beside the button; screen readers hear it as part of the row's name. */}
        {indicator && <span className="sr-only">, {INDICATOR_LABEL[indicator]}</span>}
      </button>
      {indicator && <span className={`chat-indicator chat-indicator-${indicator}`} aria-hidden />}
      <RowMenu label={`${title} actions`} items={[{ key: "rename", label: "Rename", icon: <Pencil size={14} />, onSelect: () => setEditing(true) }]} />
    </li>
  );
}
