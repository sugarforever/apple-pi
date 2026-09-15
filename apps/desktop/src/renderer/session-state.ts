import type { ApplePiMessage, ApplePiSessionEvent, SessionSnapshot, ToolCallContentPart, ToolResultContentPart } from "@apple-pi/protocol";

export type SessionSyncState =
  | { status: "synced"; generation: number }
  | { status: "resyncing"; generation: number; dirty: boolean }
  | { status: "failed"; generation: number; error: string };

type SessionMetadata = {
  lastSequence: number;
  sync: SessionSyncState;
  error?: string;
};

export type SessionState = SessionSnapshot & SessionMetadata;

export const initialSessionState: SessionState = {
  opened: false,
  messages: [],
  running: false,
  lastSequence: 0,
  sync: { status: "synced", generation: 0 },
};

export type SessionAction =
  | { type: "event"; sequence: number; payload: ApplePiSessionEvent }
  | { type: "operation_snapshot"; snapshot: SessionSnapshot }
  | { type: "resync_snapshot"; snapshot: SessionSnapshot; generation: number }
  | { type: "resync_failed"; generation: number; error: string }
  | { type: "retry_resync" }
  | { type: "error"; error: string }
  | { type: "user_message"; text: string };

const unreachable = (value: never): never => {
  throw new Error(`Unhandled Apple Pi discriminator: ${String(value)}`);
};
type AssistantContentPart = Extract<ApplePiMessage, { role: "assistant" }>["content"][number];

function withSnapshot(snapshot: SessionSnapshot, state: SessionState, sync: SessionSyncState): SessionState {
  return { ...snapshot, lastSequence: state.lastSequence, sync, error: undefined };
}

function appendAssistantPart(messages: ApplePiMessage[], part: AssistantContentPart): ApplePiMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return [...messages, { role: "assistant", content: [part] }];

  const content = [...last.content];
  const previous = content.at(-1);
  if (part.type === "text" && previous?.type === "text") content[content.length - 1] = { type: "text", text: previous.text + part.text };
  else if (part.type === "thinking" && previous?.type === "thinking") content[content.length - 1] = { type: "thinking", text: previous.text + part.text };
  else content.push(part);
  return [...messages.slice(0, -1), { role: "assistant", content }];
}

function upsertToolCall(messages: ApplePiMessage[], part: ToolCallContentPart): ApplePiMessage[] {
  let found = false;
  const updated = messages.map((message): ApplePiMessage => {
    if (message.role !== "assistant") return message;
    const content = message.content.map((item) => {
      if (item.type !== "tool_call" || item.id !== part.id) return item;
      found = true;
      return part;
    });
    return { role: "assistant", content };
  });
  return found ? updated : appendAssistantPart(messages, part);
}

function upsertToolResult(messages: ApplePiMessage[], part: ToolResultContentPart): ApplePiMessage[] {
  let found = false;
  const updated = messages.map((message): ApplePiMessage => {
    if (message.role !== "tool") return message;
    const content = message.content.map((item) => {
      if (item.toolCallId !== part.toolCallId) return item;
      found = true;
      return part;
    });
    return { role: "tool", content };
  });
  if (found) return updated;
  const last = messages.at(-1);
  if (last?.role === "tool") return [...messages.slice(0, -1), { role: "tool", content: [...last.content, part] }];
  return [...messages, { role: "tool", content: [part] }];
}

function applyEvent(state: SessionState, event: ApplePiSessionEvent): SessionState {
  switch (event.type) {
    case "text_delta":
      return { ...state, messages: appendAssistantPart(state.messages, { type: "text", text: event.text }) };
    case "thinking_delta":
      return { ...state, messages: appendAssistantPart(state.messages, { type: "thinking", text: event.text }) };
    case "tool_call": {
      const phase = event.phase;
      switch (phase) {
        case "started":
        case "updated":
        case "completed":
          break;
        default:
          unreachable(phase);
      }
      return { ...state, messages: upsertToolCall(state.messages, { type: "tool_call", id: event.id, name: event.name, arguments: event.arguments }) };
    }
    case "tool_result":
      return {
        ...state,
        messages: upsertToolResult(state.messages, {
          type: "tool_result",
          toolCallId: event.id,
          name: event.name,
          output: event.output,
          isError: event.isError,
        }),
      };
    case "lifecycle":
      switch (event.phase) {
        case "started":
          return state.opened ? { ...state, running: true, error: undefined } : state;
        case "completed":
        case "cancelled":
          return { ...state, running: false };
        case "failed":
          return { ...state, running: false, error: event.message ?? "Agent run failed" };
        default:
          return unreachable(event);
      }
    case "resync_required":
      return { ...state, sync: { status: "resyncing", generation: state.sync.generation + 1, dirty: false } };
    default:
      return unreachable(event);
  }
}

export function reduceSession(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "operation_snapshot":
      return withSnapshot(action.snapshot, state, { status: "synced", generation: state.sync.generation });
    case "resync_snapshot":
      if (state.sync.status !== "resyncing" || action.generation !== state.sync.generation) return state;
      return state.sync.dirty
        ? withSnapshot(action.snapshot, state, { status: "resyncing", generation: state.sync.generation + 1, dirty: false })
        : withSnapshot(action.snapshot, state, { status: "synced", generation: state.sync.generation });
    case "resync_failed":
      if (state.sync.status !== "resyncing" || action.generation !== state.sync.generation) return state;
      return { ...state, sync: { status: "failed", generation: state.sync.generation, error: action.error }, error: action.error };
    case "retry_resync":
      if (state.sync.status !== "failed") return state;
      return { ...state, sync: { status: "resyncing", generation: state.sync.generation + 1, dirty: false }, error: undefined };
    case "error":
      return { ...state, running: false, error: action.error };
    case "user_message":
      if (!state.opened) return state;
      return { ...state, messages: [...state.messages, { role: "user", content: [{ type: "text", text: action.text }] }] };
    case "event": {
      if (action.sequence <= state.lastSequence) return state;
      if (state.sync.status === "resyncing") return { ...state, lastSequence: action.sequence, sync: { ...state.sync, dirty: true } };
      if (state.sync.status === "failed") return { ...state, lastSequence: action.sequence };
      if (action.sequence !== state.lastSequence + 1) {
        return { ...state, lastSequence: action.sequence, sync: { status: "resyncing", generation: state.sync.generation + 1, dirty: false } };
      }
      return applyEvent({ ...state, lastSequence: action.sequence }, action.payload);
    }
    default:
      return unreachable(action);
  }
}
