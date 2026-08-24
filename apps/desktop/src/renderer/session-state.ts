export interface SessionSnapshot { opened: boolean; sessionId?: string; sessionFile?: string; messages: unknown[]; running: boolean; model?: string }
export interface SessionState extends SessionSnapshot { lastSequence: number; needsRefresh: boolean; error?: string }
export const initialSessionState: SessionState = { opened: false, messages: [], running: false, lastSequence: 0, needsRefresh: false };
export type SessionAction = { type: "event"; sequence: number; payload: unknown } | { type: "snapshot"; snapshot: SessionSnapshot } | { type: "error"; error: string };

export function reduceSession(state: SessionState, action: SessionAction): SessionState {
  if (action.type === "snapshot") return { ...state, ...action.snapshot, needsRefresh: false, error: undefined };
  if (action.type === "error") return { ...state, running: false, error: action.error };
  return { ...state, lastSequence: action.sequence, needsRefresh: action.sequence !== state.lastSequence + 1, running: true };
}
