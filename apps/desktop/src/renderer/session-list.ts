import type { SessionSnapshot } from "@apple-pi/protocol";
import type { SessionItem } from "./global.js";

export type UiSessionItem = SessionItem & { persisted: boolean };

export function shouldOpenSession(activeSessionId: string, targetSessionId: string): boolean {
  return activeSessionId !== targetSessionId;
}

export function materializeDraftSession(current: UiSessionItem[], draftId: string, snapshot: SessionSnapshot): UiSessionItem[] {
  if (!snapshot.opened) return current;
  return current.map((session) => (session.id === draftId ? { ...session, id: snapshot.sessionId, path: snapshot.sessionFile ?? session.path } : session));
}

export function reconcileSessionList(current: UiSessionItem[], remote: SessionItem[]): UiSessionItem[] {
  const drafts = current.filter((session) => !session.persisted);
  const remoteIds = new Set(remote.map((session) => session.id));
  const remotePaths = new Set(remote.map((session) => session.path));
  return [
    ...remote.map((session) => ({ ...session, persisted: true })),
    ...drafts.filter((session) => !remoteIds.has(session.id) && !remotePaths.has(session.path)),
  ];
}
