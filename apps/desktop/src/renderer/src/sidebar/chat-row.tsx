import React, { useState } from "react";
import { Pencil } from "lucide-react";
import type { ChatIndicator } from "./activity.js";
import { RowMenu } from "./row-menu.js";

export interface ChatRowProps {
  title: string;
  active: boolean;
  indicator?: ChatIndicator;
  onSelect(): void;
  onRename(name: string): void;
}

/** One saved chat under its project: title, run indicator, and a rename action. */
export function ChatRow({ title, active, indicator, onSelect, onRename }: ChatRowProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    const finish = (value: string | undefined) => {
      setEditing(false);
      const name = value?.trim();
      if (name && name !== title) onRename(name);
    };
    return (
      <li className="chat-row">
        <input
          className="chat-rename"
          aria-label="Chat name"
          defaultValue={title}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => finish(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") finish(event.currentTarget.value);
            else if (event.key === "Escape") finish(undefined);
          }}
        />
      </li>
    );
  }

  return (
    <li className="chat-row" data-indicator={indicator}>
      <button type="button" className="sidebar-item chat-item" aria-current={active ? "page" : undefined} title={title} onClick={onSelect}>
        <span className="sidebar-label">{title}</span>
      </button>
      {indicator && (
        <span className={`chat-indicator chat-indicator-${indicator}`} role="status" aria-label={indicator === "running" ? "Running" : "Finished, unread"} />
      )}
      <RowMenu label="Chat actions" items={[{ key: "rename", label: "Rename", icon: <Pencil size={14} />, onSelect: () => setEditing(true) }]} />
    </li>
  );
}
