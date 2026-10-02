import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { RpcCommand, RpcExtensionUIRequest, RpcResponse } from "@earendil-works/pi-coding-agent";
import { isExtensionEvent, type ExtensionErrorEvent } from "../extension-ui/reducer.js";
import type { PromptCommand, SessionState } from "../pi/types.js";
import { initialTranscript, isRunning, reduceTranscript, type TranscriptState } from "./reducer.js";

export interface PiSessionOptions {
  workspace: string;
  /** Session file to resume; Pi starts a new session when absent. */
  sessionFile?: string;
  /** Called once Pi reports the file a new session writes to. */
  onSessionFile?(sessionFile: string): void;
  /** Called whenever Pi settles, so session lists can pick up names and counts. */
  onSettled?(): void;
  /** Extension UI requests and extension errors, with the Pi process they came from. */
  onExtensionEvent?(event: RpcExtensionUIRequest | ExtensionErrorEvent, sessionKey: string): void;
  /** Called when the Pi process behind this session exits. */
  onExited?(sessionKey: string): void;
}

/** Pi's successful response to a command of type `T`. */
export type PiResponse<T extends RpcCommand["type"]> = Extract<RpcResponse, { command: T; success: true }>;

export interface PiSession {
  state: TranscriptState;
  running: boolean;
  /** Pi's `get_state` as of the last open or settings change; absent until Pi is up. */
  sessionState?: SessionState;
  /** Sends any command, opening Pi first if it was stopped; rejects when Pi refuses it. */
  request<T extends RpcCommand["type"]>(command: Extract<RpcCommand, { type: T }>): Promise<PiResponse<T>>;
  /** Starts a run, or queues the prompt when it carries a `streamingBehavior`. */
  prompt(command: PromptCommand): Promise<void>;
  abort(): Promise<void>;
  /** Empties Pi's steer and follow-up queue and returns the texts it held. */
  clearQueue(): Promise<string[]>;
  /** Changes the model or thinking level, then re-reads `get_state`, since Pi may adjust one to fit the other. */
  configure(command: Extract<RpcCommand, { type: "set_model" | "set_thinking_level" }>): Promise<void>;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * One Pi session for the conversation view: opens (or resumes) the Pi process,
 * restores its messages, and reduces its events. Pi may stop an idle process at
 * any time; the next command reopens it from the session file.
 */
export function usePiSession({ workspace, sessionFile, onSessionFile, onSettled, onExtensionEvent, onExited }: PiSessionOptions): PiSession {
  const [state, dispatch] = useReducer(reduceTranscript, initialTranscript);
  const [sessionState, setSessionState] = useState<SessionState>();
  const key = useRef<string | undefined>(undefined);
  const opening = useRef<Promise<string> | undefined>(undefined);
  const file = useRef(sessionFile);
  const callbacks = useRef({ onSessionFile, onSettled, onExtensionEvent, onExited });
  useEffect(() => {
    callbacks.current = { onSessionFile, onSettled, onExtensionEvent, onExited };
  });

  useEffect(() => {
    return window.applePi.pi.onEvent((message) => {
      if (message.sessionKey !== key.current) return;
      if ("exited" in message) {
        key.current = undefined;
        dispatch({ type: "exited", at: Date.now() });
        callbacks.current.onExited?.(message.sessionKey);
        return;
      }
      if (isExtensionEvent(message.event)) {
        callbacks.current.onExtensionEvent?.(message.event, message.sessionKey);
        return;
      }
      dispatch({ type: "event", event: message.event, at: Date.now() });
      if (message.event.type === "agent_settled") callbacks.current.onSettled?.();
    });
  }, []);

  const send = useCallback(async <T extends RpcCommand["type"]>(sessionKey: string, command: Extract<RpcCommand, { type: T }>): Promise<PiResponse<T>> => {
    const response = await window.applePi.pi.send(sessionKey, command);
    if (!response.success) throw new Error(response.error);
    return response as PiResponse<T>;
  }, []);

  const adoptState = useCallback((next: SessionState) => {
    setSessionState(next);
    const reported = next.sessionFile;
    if (reported && reported !== file.current) {
      file.current = reported;
      callbacks.current.onSessionFile?.(reported);
    }
  }, []);

  /** Returns a live session key, starting Pi and restoring its transcript when needed. */
  const open = useCallback((): Promise<string> => {
    if (key.current) return Promise.resolve(key.current);
    // A new session has no file to key it by, so concurrent callers must share one start.
    opening.current ??= (async () => {
      const sessionKey = await window.applePi.pi.open({ workspace, sessionFile: file.current });
      key.current = sessionKey;
      const [messages, current] = await Promise.all([send(sessionKey, { type: "get_messages" }), send(sessionKey, { type: "get_state" })]);
      dispatch({ type: "restored", messages: messages.data.messages, isStreaming: current.data.isStreaming, at: Date.now() });
      adoptState(current.data);
      return sessionKey;
    })().finally(() => (opening.current = undefined));
    return opening.current;
  }, [adoptState, send, workspace]);

  // Open right away: history for an existing session, model and commands for a new one.
  useEffect(() => {
    open().catch((error: unknown) => dispatch({ type: "failed", error: errorText(error) }));
  }, [open]);

  const request = useCallback(
    async <T extends RpcCommand["type"]>(command: Extract<RpcCommand, { type: T }>): Promise<PiResponse<T>> => send(await open(), command),
    [open, send],
  );

  const prompt = useCallback(
    async (command: PromptCommand) => {
      // A queued prompt shows in the queue, not as a pending turn.
      const starts = !command.streamingBehavior;
      if (starts) dispatch({ type: "prompt_sent", text: command.message, at: Date.now() });
      try {
        const sessionKey = await open();
        // Restoring can replace the transcript; show the prompt again until Pi echoes it.
        if (starts) dispatch({ type: "prompt_sent", text: command.message, at: Date.now() });
        const response = await send(sessionKey, command);
        // An extension command can handle the prompt without a run or a user message.
        if (response.data.disposition === "handled") dispatch({ type: "prompt_handled" });
      } catch (error) {
        dispatch({ type: starts ? "failed" : "error", error: errorText(error) });
      }
    },
    [open, send],
  );

  const abort = useCallback(async () => {
    if (!key.current) return;
    await send(key.current, { type: "abort" }).catch((error: unknown) => dispatch({ type: "error", error: errorText(error) }));
  }, [send]);

  const clearQueue = useCallback(async (): Promise<string[]> => {
    if (!key.current) return [];
    try {
      const { data } = await send(key.current, { type: "clear_queue" });
      return [...data.steering, ...data.followUp];
    } catch (error) {
      dispatch({ type: "error", error: errorText(error) });
      return [];
    }
  }, [send]);

  const configure = useCallback(
    async (command: Extract<RpcCommand, { type: "set_model" | "set_thinking_level" }>) => {
      try {
        await request(command);
        adoptState((await request({ type: "get_state" })).data);
      } catch (error) {
        dispatch({ type: "error", error: errorText(error) });
      }
    },
    [adoptState, request],
  );

  return { state, running: isRunning(state), sessionState, request, prompt, abort, clearQueue, configure };
}
