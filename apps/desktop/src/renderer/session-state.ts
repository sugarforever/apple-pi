import type { ApplePiMessage, ApplePiSessionEvent, ModelItem, SessionSnapshot } from "@apple-pi/protocol";

export type { SessionSnapshot } from "@apple-pi/protocol";
export interface SessionState {
  opened: boolean;
  sessionId?: string;
  sessionFile?: string;
  messages: ApplePiMessage[];
  running: boolean;
  model?: ModelItem;
  lastSequence: number;
  needsRefresh: boolean;
  error?: string;
}
export const initialSessionState: SessionState = { opened: false, messages: [], running: false, lastSequence: 0, needsRefresh: false };
export type SessionAction = { type: "event"; sequence: number; payload: ApplePiSessionEvent } | { type: "snapshot"; snapshot: SessionSnapshot } | { type: "error"; error: string };

export function reduceSession(state: SessionState, action: SessionAction): SessionState {
  if (action.type === "snapshot") return { ...state, ...action.snapshot, needsRefresh: false, error: undefined };
  if (action.type === "error") return { ...state, running: false, error: action.error };
  return { ...state, lastSequence: action.sequence, needsRefresh: action.sequence !== state.lastSequence + 1, running: state.opened };
}
