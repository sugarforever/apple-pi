import { useCallback, useEffect, useReducer } from "react";
import { initialActivity, reduceActivity, type ActivityState } from "./activity.js";

export interface Activity {
  state: ActivityState;
  /** Records the session file a Pi process writes, once Pi reports it. */
  attach(sessionKey: string, sessionFile: string): void;
  /** Marks the chat on screen as read; undefined when no saved chat is on screen. */
  view(sessionFile: string | undefined): void;
}

/** Running and unread chats, from every Pi process's events. */
export function useActivity(): Activity {
  const [state, dispatch] = useReducer(reduceActivity, initialActivity);

  useEffect(
    () =>
      window.applePi.pi.onEvent((message) => {
        const { sessionKey } = message;
        if ("exited" in message) dispatch({ type: "settled", sessionKey });
        else if (message.event.type === "agent_start") dispatch({ type: "started", sessionKey });
        else if (message.event.type === "agent_settled") dispatch({ type: "settled", sessionKey });
      }),
    [],
  );

  const attach = useCallback((sessionKey: string, sessionFile: string) => dispatch({ type: "attached", sessionKey, sessionFile }), []);
  const view = useCallback((sessionFile: string | undefined) => dispatch({ type: "viewing", sessionFile }), []);

  return { state, attach, view };
}
