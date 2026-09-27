import React from "react";
import type { UiSessionItem } from "../../session-list.js";
import { SessionRow } from "./session-row.js";

export interface SessionListProps {
  id: string;
  workspaceName: string;
  sessions: UiSessionItem[];
  activeSessionId: string;
  onOpenSession(session: UiSessionItem): void;
}

export function SessionList({ id, workspaceName, sessions, activeSessionId, onOpenSession }: SessionListProps) {
  return (
    <nav id={id} className="workspace-sessions" aria-label={`${workspaceName} sessions`}>
      {sessions.map((session) => (
        <SessionRow key={session.id} session={session} current={activeSessionId === session.id} onOpen={onOpenSession} />
      ))}
    </nav>
  );
}
