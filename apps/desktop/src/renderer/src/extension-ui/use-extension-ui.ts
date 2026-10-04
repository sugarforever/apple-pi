import { useCallback, useEffect, useReducer, useRef } from "react";
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { initialExtensionUI, reduceExtensionUI, unhandledResponse, type ExtensionErrorEvent, type ExtensionUIState, type PendingDialog } from "./reducer.js";

export interface ExtensionUI {
  state: ExtensionUIState;
  /** Takes one extension UI request or extension error from the given Pi process. */
  receive(event: RpcExtensionUIRequest | ExtensionErrorEvent, sessionKey: string): void;
  /** Answers the dialog and closes it. */
  respond(dialog: PendingDialog, response: RpcExtensionUIResponse): void;
  dismissNotice(id: string): void;
  /** Drops the dialogs of a Pi process that has exited. */
  exited(sessionKey: string): void;
}

let nextError = 0;

const send = (sessionKey: string, response: RpcExtensionUIResponse) =>
  // The process may have stopped since it asked; Pi resolves its own dialogs then.
  window.applePi.pi.respondUI(sessionKey, response).catch((error: unknown) => console.warn("[extension-ui] response not delivered", error));

/** Extension UI state for one conversation, plus the responses Pi waits on. */
export function useExtensionUI(): ExtensionUI {
  const [state, dispatch] = useReducer(reduceExtensionUI, initialExtensionUI);

  const receive = useCallback((event: RpcExtensionUIRequest | ExtensionErrorEvent, sessionKey: string) => {
    if (event.type === "extension_error") {
      dispatch({ type: "extension_error", id: `extension-error-${++nextError}`, error: event });
      return;
    }
    const unhandled = unhandledResponse(event);
    if (unhandled) {
      console.warn(`[extension-ui] unsupported method "${String(event.method)}"; cancelled so Pi does not wait`);
      void send(sessionKey, unhandled);
      return;
    }
    dispatch({ type: "request", request: event, sessionKey, at: Date.now() });
  }, []);

  const respond = useCallback((dialog: PendingDialog, response: RpcExtensionUIResponse) => {
    dispatch({ type: "resolved", id: dialog.request.id });
    void send(dialog.sessionKey, response);
  }, []);

  const dismissNotice = useCallback((id: string) => dispatch({ type: "dismissed", id }), []);
  const exited = useCallback((sessionKey: string) => dispatch({ type: "exited", sessionKey }), []);

  // Pi's TUI sets the terminal title; here it names the window while this conversation is open.
  const original = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!state.title) return;
    original.current ??= document.title;
    document.title = state.title;
  }, [state.title]);
  useEffect(
    () => () => {
      if (original.current !== undefined) document.title = original.current;
    },
    [],
  );

  return { state, receive, respond, dismissNotice, exited };
}
