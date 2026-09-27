import React from "react";
import { MessageSquare } from "lucide-react";
import type { UiSessionItem } from "../../session-list.js";

export interface SessionRowProps {
  session: UiSessionItem;
  current: boolean;
  onOpen(session: UiSessionItem): void;
}

export function SessionRow({ session, current, onOpen }: SessionRowProps) {
  return (
    <button
      title={session.persisted ? session.name : "Untitled session"}
      className={current ? "selected" : ""}
      aria-current={current ? "page" : undefined}
      onClick={() => onOpen(session)}
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
  );
}
