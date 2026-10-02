import { useCallback, useEffect, useReducer, useRef } from "react";
import type { RpcCommand, RpcResponse } from "@earendil-works/pi-coding-agent";
import { initialTranscript, isRunning, reduceTranscript, type TranscriptState } from "./reducer.js";

export interface PiSessionOptions {
  workspace: string;
  /** Session file to resume; a new session starts on the first prompt when absent. */
  sessionFile?: string;
  /** Called once Pi reports the file a new session writes to. */
  onSessionFile?(sessionFile: string): void;
  /** Called whenever Pi settles, so session lists can pick up names and counts. */
  onSettled?(): void;
}

export interface PiSession {
  state: TranscriptState;
  running: boolean;
  prompt(message: string): Promise<void>;
  abort(): Promise<void>;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * One Pi session for the conversation view: opens (or resumes) the Pi process,
 * restores its messages, and reduces its events. Pi may stop an idle process at
 * any time; the next prompt reopens it from the session file.
 */
export function usePiSession({ workspace, sessionFile, onSessionFile, onSettled }: PiSessionOptions): PiSession {
  const [state, dispatch] = useReducer(reduceTranscript, initialTranscript);
  const key = useRef<string | undefined>(undefined);
  const file = useRef(sessionFile);
  const callbacks = useRef({ onSessionFile, onSettled });
  useEffect(() => {
    callbacks.current = { onSessionFile, onSettled };
  });

  useEffect(() => {
    return window.applePi.pi.onEvent((message) => {
      if (message.sessionKey !== key.current) return;
      if ("exited" in message) {
        key.current = undefined;
        dispatch({ type: "exited", at: Date.now() });
        return;
      }
      dispatch({ type: "event", event: message.event, at: Date.now() });
      if (message.event.type === "agent_settled") callbacks.current.onSettled?.();
    });
  }, []);

  const command = useCallback(async (sessionKey: string, payload: RpcCommand): Promise<RpcResponse> => {
    const response = await window.applePi.pi.send(sessionKey, payload);
    if (!response.success) throw new Error(response.error);
    return response;
  }, []);

  /** Returns a live session key, starting Pi and restoring its transcript when needed. */
  const open = useCallback(async (): Promise<string> => {
    if (key.current) return key.current;
    const sessionKey = await window.applePi.pi.open({ workspace, sessionFile: file.current });
    key.current = sessionKey;
    const [messages, sessionState] = await Promise.all([command(sessionKey, { type: "get_messages" }), command(sessionKey, { type: "get_state" })]);
    if (messages.command === "get_messages" && messages.success && sessionState.command === "get_state" && sessionState.success) {
      dispatch({ type: "restored", messages: messages.data.messages, isStreaming: sessionState.data.isStreaming, at: Date.now() });
      const reported = sessionState.data.sessionFile;
      if (reported && reported !== file.current) {
        file.current = reported;
        callbacks.current.onSessionFile?.(reported);
      }
    }
    return sessionKey;
  }, [command, workspace]);

  useEffect(() => {
    // An existing session is opened right away to show its history; a new one waits for a prompt.
    if (sessionFile) open().catch((error: unknown) => dispatch({ type: "failed", error: errorText(error) }));
  }, [open, sessionFile]);

  const prompt = useCallback(
    async (message: string) => {
      dispatch({ type: "prompt_sent", text: message, at: Date.now() });
      try {
        const sessionKey = await open();
        // Restoring can replace the transcript; show the prompt again until Pi echoes it.
        dispatch({ type: "prompt_sent", text: message, at: Date.now() });
        const response = await command(sessionKey, { type: "prompt", message });
        // An extension command can handle the prompt without a run or a user message.
        if (response.command === "prompt" && response.success && response.data.disposition === "handled") dispatch({ type: "prompt_handled" });
      } catch (error) {
        dispatch({ type: "failed", error: errorText(error) });
      }
    },
    [command, open],
  );

  const abort = useCallback(async () => {
    if (!key.current) return;
    await command(key.current, { type: "abort" }).catch((error: unknown) => dispatch({ type: "failed", error: errorText(error) }));
  }, [command]);

  return { state, running: isRunning(state), prompt, abort };
}
