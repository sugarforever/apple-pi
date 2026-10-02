import type { PiProcessEvent } from "../../../shared/pi-api.js";
import type { AgentMessage, AssistantContent, AssistantMessage, AssistantMessageEvent } from "../pi/types.js";

export interface ToolExecution {
  status: "running" | "done" | "error";
  /** Latest output text Pi reported for the call, partial while running. */
  output?: string;
}

/** One session-level agent run, from `agent_start` until Pi settles. */
export interface RunTiming {
  /** Index in `messages` where the run's first message lands. */
  messageIndex: number;
  startedAt: number;
  /** Absent while the run is live. */
  endedAt?: number;
}

export interface TranscriptState {
  /** Completed messages, in session order. */
  messages: AgentMessage[];
  /** The assistant message being streamed, rebuilt from deltas. */
  streaming?: AssistantMessage;
  /** Live tool execution status by tool call id. */
  tools: Readonly<Record<string, ToolExecution>>;
  runs: RunTiming[];
  /** A prompt sent but not yet echoed back by Pi as a user message. */
  pendingPrompt?: { text: string; at: number };
  queue: { steering: readonly string[]; followUp: readonly string[] };
  /** Transient session activity such as compaction or a retry wait. */
  status?: string;
  error?: string;
}

export type TranscriptAction =
  | { type: "restored"; messages: AgentMessage[]; isStreaming: boolean; at: number }
  | { type: "event"; event: PiProcessEvent; at: number }
  | { type: "prompt_sent"; text: string; at: number }
  | { type: "prompt_handled" }
  /** A prompt or Pi itself failed; whatever was running is over. */
  | { type: "failed"; error: string }
  /** A side request failed (queueing, abort); the run, if any, goes on. */
  | { type: "error"; error: string }
  | { type: "exited"; at: number };

export const initialTranscript: TranscriptState = { messages: [], tools: {}, runs: [], queue: { steering: [], followUp: [] } };

export const isRunning = (state: TranscriptState): boolean => {
  const last = state.runs.at(-1);
  return Boolean(state.pendingPrompt) || (last !== undefined && last.endedAt === undefined);
};

export function reduceTranscript(state: TranscriptState, action: TranscriptAction): TranscriptState {
  switch (action.type) {
    case "restored":
      return {
        ...initialTranscript,
        messages: action.messages,
        runs: action.isStreaming ? [{ messageIndex: action.messages.length, startedAt: action.at }] : [],
      };
    case "prompt_sent":
      return { ...state, pendingPrompt: { text: action.text, at: action.at }, error: undefined };
    case "prompt_handled":
      return { ...state, pendingPrompt: undefined };
    case "failed":
      return { ...endRun(state, undefined), pendingPrompt: undefined, error: action.error };
    case "error":
      return { ...state, error: action.error };
    case "exited":
      return { ...endRun(state, action.at), pendingPrompt: undefined, status: undefined };
    case "event":
      return reduceEvent(state, action.event, action.at);
  }
}

function reduceEvent(state: TranscriptState, event: PiProcessEvent, at: number): TranscriptState {
  switch (event.type) {
    case "agent_start": {
      if (isOpen(state.runs.at(-1))) return state;
      return { ...state, runs: [...state.runs, { messageIndex: state.messages.length, startedAt: at }] };
    }
    case "agent_settled":
      return { ...endRun(state, at), status: undefined };
    case "message_start":
      return event.message.role === "assistant" ? { ...state, streaming: event.message } : state;
    case "message_update":
      return state.streaming ? { ...state, streaming: applyDelta(state.streaming, event.assistantMessageEvent) } : state;
    case "message_end": {
      const { message } = event;
      const next = { ...state, messages: [...state.messages, message] };
      if (message.role === "assistant") next.streaming = undefined;
      if (message.role === "user") next.pendingPrompt = undefined;
      return next;
    }
    case "tool_execution_start":
      return withTool(state, event.toolCallId, { status: "running" });
    case "tool_execution_update":
      return withTool(state, event.toolCallId, { status: "running", output: resultText(event.partialResult) });
    case "tool_execution_end":
      return withTool(state, event.toolCallId, { status: event.isError ? "error" : "done", output: resultText(event.result) });
    case "queue_update":
      return { ...state, queue: { steering: event.steering, followUp: event.followUp } };
    case "compaction_start":
      return { ...state, status: "Compacting context…" };
    case "compaction_end":
      return { ...state, status: undefined, error: event.errorMessage ? `Compaction failed: ${event.errorMessage}` : state.error };
    case "auto_retry_start":
      return { ...state, status: `Retrying (${event.attempt}/${event.maxAttempts}) after: ${event.errorMessage}` };
    case "auto_retry_end":
      return { ...state, status: undefined, error: event.success ? state.error : event.finalError };
    default:
      // Everything else (turn boundaries, session info, extension UI, events
      // newer than this client) carries nothing the transcript shows.
      return state;
  }
}

const isOpen = (run: RunTiming | undefined): boolean => run !== undefined && run.endedAt === undefined;

function endRun(state: TranscriptState, at: number | undefined): TranscriptState {
  const last = state.runs.at(-1);
  // A message still streaming when the run ends (process exit) is kept as far as it got.
  const messages = state.streaming ? [...state.messages, state.streaming] : state.messages;
  if (!last || !isOpen(last)) return { ...state, messages, streaming: undefined };
  return { ...state, messages, streaming: undefined, runs: [...state.runs.slice(0, -1), { ...last, endedAt: at ?? last.startedAt }] };
}

function withTool(state: TranscriptState, id: string, execution: ToolExecution): TranscriptState {
  return { ...state, tools: { ...state.tools, [id]: { ...state.tools[id], ...execution } } };
}

/** Applies one wire delta to the streaming message. Pi's `message_end` later replaces it wholesale. */
export function applyDelta(message: AssistantMessage, update: AssistantMessageEvent): AssistantMessage {
  if (!("contentIndex" in update)) return message;
  const content: AssistantContent[] = [...message.content];
  const index = update.contentIndex;
  const current = content[index];
  switch (update.type) {
    case "text_start":
      content[index] = { type: "text", text: "" };
      break;
    case "text_delta":
      content[index] = { type: "text", text: (current?.type === "text" ? current.text : "") + update.delta };
      break;
    case "text_end":
      content[index] = { type: "text", text: update.content };
      break;
    case "thinking_start":
      content[index] = { type: "thinking", thinking: "" };
      break;
    case "thinking_delta":
      content[index] = { type: "thinking", thinking: (current?.type === "thinking" ? current.thinking : "") + update.delta };
      break;
    case "thinking_end":
      content[index] = { type: "thinking", thinking: update.content };
      break;
    case "toolcall_start":
      content[index] = { type: "toolCall", id: update.id, name: update.toolName, arguments: {} };
      break;
    case "toolcall_end":
      content[index] = update.toolCall;
      break;
    default:
      // toolcall_delta carries partial JSON; the label waits for toolcall_end.
      return message;
  }
  return { ...message, content };
}

/** The text parts of a tool result (`{ content: [{ type: "text", text }] }`), or undefined. */
export function resultText(result: unknown): string | undefined {
  const content = (result as { content?: unknown } | null | undefined)?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  return text || undefined;
}
