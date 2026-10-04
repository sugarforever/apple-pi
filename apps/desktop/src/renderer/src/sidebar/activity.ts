/*
 * Which chats are running and which finished out of sight, across every live
 * Pi process. Events arrive by session key; the sidebar asks by session file.
 * A resumed session's key is its file; a new one's key maps to the file Pi
 * reports once it opens.
 */

export interface ActivityState {
  /** Session file per key, for keys that are not themselves the file. */
  files: Readonly<Record<string, string>>;
  /** Keys whose agent is mid-run. */
  running: Readonly<Record<string, true>>;
  /** Session files that finished a run while another chat was on screen. */
  unread: Readonly<Record<string, true>>;
  /** The session file on screen, if any. */
  viewing?: string;
}

export type ActivityAction =
  | { type: "attached"; sessionKey: string; sessionFile: string }
  | { type: "started"; sessionKey: string }
  /** The run ended, or the process behind it exited. */
  | { type: "settled"; sessionKey: string }
  | { type: "viewing"; sessionFile?: string };

export type ChatIndicator = "running" | "unread";

export const initialActivity: ActivityState = { files: {}, running: {}, unread: {} };

const fileOf = (state: ActivityState, sessionKey: string) => state.files[sessionKey] ?? sessionKey;

const without = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = record;
  return rest;
};

export function reduceActivity(state: ActivityState, action: ActivityAction): ActivityState {
  switch (action.type) {
    case "attached":
      if (action.sessionKey === action.sessionFile || state.files[action.sessionKey] === action.sessionFile) return state;
      return { ...state, files: { ...state.files, [action.sessionKey]: action.sessionFile } };
    case "started":
      if (state.running[action.sessionKey]) return state;
      return { ...state, running: { ...state.running, [action.sessionKey]: true } };
    case "settled": {
      if (!state.running[action.sessionKey]) return state;
      const file = fileOf(state, action.sessionKey);
      const unread = file === state.viewing ? state.unread : { ...state.unread, [file]: true as const };
      return { ...state, running: without(state.running, action.sessionKey), unread };
    }
    case "viewing":
      return { ...state, viewing: action.sessionFile, unread: action.sessionFile ? without(state.unread, action.sessionFile) : state.unread };
  }
}

/** The sidebar's indicator for one session file. */
export function chatIndicator(state: ActivityState, sessionFile: string): ChatIndicator | undefined {
  if (Object.keys(state.running).some((key) => fileOf(state, key) === sessionFile)) return "running";
  return state.unread[sessionFile] ? "unread" : undefined;
}
