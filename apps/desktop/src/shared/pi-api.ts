import type {
  JsonAgentSessionEvent,
  RpcCommand,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcResponse,
  SessionInfo,
} from "@earendil-works/pi-coding-agent";

/** Everything Pi writes on stdout that is not a response to one of our commands. */
export type PiProcessEvent = JsonAgentSessionEvent | RpcExtensionUIRequest;

export interface PiProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** The last few KB of stderr, for diagnostics. */
  stderr: string;
}

/** Pushed on `pi:event`: one Pi event, or the end of that session's process. */
export type PiSessionMessage = { sessionKey: string; event: PiProcessEvent } | { sessionKey: string; exited: PiProcessExit };

/** What the native menu asks the window to do; main sends these on `app:command`. */
export type AppCommand = "new-chat" | "add-project" | "open-settings" | "toggle-sidebar" | "search-chats" | "previous-chat" | "next-chat";

export interface Workspace {
  path: string;
  name: string;
}

export interface PiOpenRequest {
  workspace: string;
  /** Session file to resume; Pi starts a new session when omitted. */
  sessionFile?: string;
}

/**
 * The renderer's view of Pi: workspaces Apple Pi remembers, the session files Pi
 * wrote for them, and a raw RPC channel per open session. Commands and events
 * cross unchanged; Pi owns their meaning.
 */
export interface ApplePiApi {
  workspaces: {
    /** Asks the user for a folder and remembers it; null when cancelled. */
    pick(): Promise<Workspace | null>;
    list(): Promise<Workspace[]>;
    remove(path: string): Promise<void>;
  };
  sessions: {
    list(workspace: string): Promise<SessionInfo[]>;
  };
  pi: {
    /** Starts (or reuses) a Pi process and returns its opaque session key. */
    open(request: PiOpenRequest): Promise<string>;
    send(sessionKey: string, command: RpcCommand): Promise<RpcResponse>;
    respondUI(sessionKey: string, response: RpcExtensionUIResponse): Promise<void>;
    close(sessionKey: string): Promise<void>;
    onEvent(listener: (message: PiSessionMessage) => void): () => void;
  };
  shell: {
    /** Opens Pi's user settings.json in the default editor, creating it if needed. */
    openSettingsFile(): Promise<void>;
    openTerminal(workspace: string): Promise<void>;
  };
  app: {
    /** Delivers native menu commands until the returned function is called. */
    onCommand(listener: (command: AppCommand) => void): () => void;
  };
}
