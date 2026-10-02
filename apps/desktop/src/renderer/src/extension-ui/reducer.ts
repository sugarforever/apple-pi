import type { ExtensionError, RpcExtensionUIRequest, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";

/*
 * Extension UI for one conversation: what Pi's extensions asked to show, kept
 * apart from the transcript. The reducer is pure; the hook sends responses.
 */

/** Requests Pi blocks on until the client answers. */
export type DialogRequest = Extract<RpcExtensionUIRequest, { method: "select" | "confirm" | "input" | "editor" }>;

/** The line Pi writes when an extension handler throws. Pi types the payload but not the line. */
export type ExtensionErrorEvent = { type: "extension_error" } & Pick<ExtensionError, "extensionPath" | "event" | "error">;

export type NoticeLevel = "info" | "warning" | "error";

export interface PendingDialog {
  request: DialogRequest;
  /** The Pi process that asked, which is the one that must receive the answer. */
  sessionKey: string;
  /** When Pi gives up and resolves the dialog itself; absent without a timeout. */
  deadline?: number;
}

export interface Notice {
  id: string;
  level: NoticeLevel;
  message: string;
}

export interface Widget {
  key: string;
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
}

export interface ExtensionUIState {
  /** Shown one at a time, oldest first. */
  dialogs: readonly PendingDialog[];
  notices: readonly Notice[];
  /** Footer status entries in the order extensions first set them. */
  statuses: readonly { key: string; text: string }[];
  widgets: readonly Widget[];
  title?: string;
  /** The latest draft an extension asked for; `id` changes with each request. */
  editorText?: { id: string; text: string };
}

export type ExtensionUIAction =
  | { type: "request"; request: RpcExtensionUIRequest; sessionKey: string; at: number }
  | { type: "extension_error"; id: string; error: ExtensionErrorEvent }
  /** A dialog was answered, cancelled, or timed out. */
  | { type: "resolved"; id: string }
  | { type: "dismissed"; id: string }
  /** The Pi process is gone; nothing can answer its open dialogs. */
  | { type: "exited"; sessionKey: string };

export const initialExtensionUI: ExtensionUIState = { dialogs: [], notices: [], statuses: [], widgets: [] };

const DIALOG_METHODS: ReadonlySet<string> = new Set(["select", "confirm", "input", "editor"]);
const KNOWN_METHODS: ReadonlySet<string> = new Set([...DIALOG_METHODS, "notify", "setStatus", "setWidget", "setTitle", "set_editor_text"]);

export const isDialog = (request: RpcExtensionUIRequest): request is DialogRequest => DIALOG_METHODS.has(request.method);

/** True for the lines this module handles: extension UI requests and extension errors. */
export function isExtensionEvent(event: { type: string }): event is RpcExtensionUIRequest | ExtensionErrorEvent {
  return event.type === "extension_ui_request" || event.type === "extension_error";
}

// CSI sequences (colours, cursor moves), OSC sequences (titles, links), and two-byte escapes.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** Removes terminal escape codes; extensions style their text for Pi's TUI. */
export const stripAnsi = (text: string): string => text.replace(ANSI, "");

export const cancelResponse = (id: string): RpcExtensionUIResponse => ({ type: "extension_ui_response", id, cancelled: true });
export const valueResponse = (id: string, value: string): RpcExtensionUIResponse => ({ type: "extension_ui_response", id, value });
export const confirmResponse = (id: string, confirmed: boolean): RpcExtensionUIResponse => ({ type: "extension_ui_response", id, confirmed });

/**
 * The answer to send right away for a request this client cannot show: a
 * method newer than this client might be blocking Pi, and a cancel for an id
 * Pi is not waiting on is ignored.
 */
export function unhandledResponse(request: RpcExtensionUIRequest): RpcExtensionUIResponse | undefined {
  if (KNOWN_METHODS.has(request.method)) return undefined;
  const { id } = request as { id?: unknown };
  return typeof id === "string" ? cancelResponse(id) : undefined;
}

export function reduceExtensionUI(state: ExtensionUIState, action: ExtensionUIAction): ExtensionUIState {
  switch (action.type) {
    case "request":
      return reduceRequest(state, action.request, action.sessionKey, action.at);
    case "extension_error": {
      const { extensionPath, error } = action.error;
      const name = extensionPath?.split(/[\\/]/).filter(Boolean).at(-1) ?? "extension";
      return withNotice(state, { id: action.id, level: "warning", message: `${name}: ${error}` });
    }
    case "resolved":
      return { ...state, dialogs: state.dialogs.filter((dialog) => dialog.request.id !== action.id) };
    case "dismissed":
      return { ...state, notices: state.notices.filter((notice) => notice.id !== action.id) };
    case "exited":
      // Statuses, widgets, and the title stay: Pi stops idle processes and resumes them on demand.
      return { ...state, dialogs: state.dialogs.filter((dialog) => dialog.sessionKey !== action.sessionKey) };
  }
}

function reduceRequest(state: ExtensionUIState, request: RpcExtensionUIRequest, sessionKey: string, at: number): ExtensionUIState {
  if (isDialog(request)) {
    const timeout = "timeout" in request ? request.timeout : undefined;
    return { ...state, dialogs: [...state.dialogs, { request, sessionKey, deadline: timeout ? at + timeout : undefined }] };
  }
  switch (request.method) {
    case "notify":
      return withNotice(state, { id: request.id, level: request.notifyType ?? "info", message: stripAnsi(request.message) });
    case "setStatus":
      return {
        ...state,
        statuses: upsert(state.statuses, request.statusKey, request.statusText && { key: request.statusKey, text: stripAnsi(request.statusText) }),
      };
    case "setWidget":
      return {
        ...state,
        widgets: upsert(
          state.widgets,
          request.widgetKey,
          request.widgetLines && { key: request.widgetKey, lines: request.widgetLines.map(stripAnsi), placement: request.widgetPlacement ?? "aboveEditor" },
        ),
      };
    case "setTitle":
      return { ...state, title: stripAnsi(request.title) || undefined };
    case "set_editor_text":
      return { ...state, editorText: { id: request.id, text: request.text } };
    default:
      // A method newer than this client; the hook has already answered it.
      return state;
  }
}

/** Replaces the entry for `key` in place, appends it, or removes it when `next` is empty. */
function upsert<T extends { key: string }>(items: readonly T[], key: string, next: T | undefined | "" | null): readonly T[] {
  if (!next) return items.filter((item) => item.key !== key);
  return items.some((item) => item.key === key) ? items.map((item) => (item.key === key ? next : item)) : [...items, next];
}

const MAX_NOTICES = 3;

function withNotice(state: ExtensionUIState, notice: Notice): ExtensionUIState {
  return { ...state, notices: [...state.notices, notice].slice(-MAX_NOTICES) };
}
