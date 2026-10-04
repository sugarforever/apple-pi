import type { AgentMessage, AssistantMessage, ToolCall, ToolResultMessage, UserMessage } from "../pi/types.js";
import { type ActivityVerb, rowLabel, summarize, toolTarget, toolVerb } from "./activity-labels.js";
import { countChanges, type DiffLine, type LineChanges, lineCount, parseEditDiff } from "./diff.js";
import { isRunning, resultText, type ToolExecution, type TranscriptState } from "./reducer.js";

/** One line inside "Worked for …": a tool call or a block of thinking. */
export interface ActivityRow {
  key: string;
  verb: ActivityVerb;
  label: string;
  status: ToolExecution["status"];
  /** What the row acted on, for its detail view: a command, arguments, or the thinking text. */
  input?: string;
  output?: string;
  /** Lines an edit or write added and removed, shown after the label. */
  changes?: LineChanges;
  /** A richer detail view than the raw input and output: an edit's diff or a file's content. */
  view?: ToolView;
}

export type ToolView = { kind: "diff"; path: string; lines: DiffLine[] } | { kind: "code"; path: string; code: string };

export type ActivityItem =
  | { kind: "text"; key: string; text: string }
  /** Consecutive rows; a group of one renders as a single row. */
  | { kind: "rows"; key: string; rows: ActivityRow[]; summary: string }
  /** A message Pi or an extension added (bash execution, summaries, custom) or a role this client does not know. */
  | { kind: "message"; key: string; message: AgentMessage }
  | { kind: "unknown"; key: string; value: unknown };

/** A user message and everything Pi did in response, until the next user message. */
export interface Turn {
  key: string;
  user: UserMessage;
  /** True when the user message is a prompt Pi has not echoed back yet. */
  pending: boolean;
  activity: ActivityItem[];
  /** The last assistant message's text, shown outside the collapsed activity. */
  answer?: string;
  notice?: { tone: "error" | "muted"; text: string };
  running: boolean;
  startedAt?: number;
  durationMs?: number;
}

export type TranscriptEntry = { kind: "turn"; turn: Turn } | { kind: "message"; key: string; message: AgentMessage };

/** A user message and the messages after it, until the next one. */
interface Segment {
  user: UserMessage;
  start: number;
  pending: boolean;
  messages: { index: number; message: AgentMessage }[];
}

interface Draft {
  turn: Turn;
  messages: Segment["messages"];
  /** Activity items that belong to each assistant message, so the answer can be lifted out. */
  textItems: Map<number, ActivityItem[]>;
}

const MAX_OUTPUT_CHARS = 20_000;

/** What each turn was built from, compared by identity to decide whether it can be reused. */
const inputsOf = new WeakMap<Turn, unknown[]>();

/**
 * Groups session messages into turns for display. Pure; recomputed from reducer
 * state. A turn of `previous` whose messages, tool status, results, and run
 * timing are all unchanged is returned as the same object, so a streaming
 * delta rebuilds only the turn it lands in.
 */
export function buildTranscript(state: TranscriptState, previous: readonly TranscriptEntry[] = []): TranscriptEntry[] {
  const all = state.streaming ? [...state.messages, state.streaming] : state.messages;
  const results = new Map<string, ToolResultMessage>();
  for (const message of all) if (message.role === "toolResult") results.set(message.toolCallId, message);

  const entries: TranscriptEntry[] = [];
  const segments: Segment[] = [];
  all.forEach((message, index) => {
    if (message.role === "user") segments.push({ user: message, start: index, pending: false, messages: [] });
    else if (message.role === "system" || message.role === "toolResult") return;
    else if (segments.length > 0) segments.at(-1)!.messages.push({ index, message });
    else entries.push({ kind: "message", key: `message-${index}`, message });
  });
  const { pendingPrompt } = state;
  if (pendingPrompt)
    segments.push({ user: { role: "user", content: pendingPrompt.text, timestamp: pendingPrompt.at }, start: all.length, pending: true, messages: [] });

  const before = new Map(previous.flatMap((entry) => (entry.kind === "turn" ? [[entry.turn.key, entry.turn] as const] : [])));
  const running = isRunning(state);
  segments.forEach((segment, i) => {
    const nextStart = segments[i + 1]?.start ?? Infinity;
    const live = running && i === segments.length - 1;
    const runs = state.runs.filter((run) => run.messageIndex >= segment.start && run.messageIndex < nextStart);
    const inputs: unknown[] = [segment.pending ? pendingPrompt : segment.user, live, ...runs];
    for (const { message } of segment.messages) {
      inputs.push(message, message === state.streaming);
      if (message.role !== "assistant") continue;
      for (const block of message.content) if (block.type === "toolCall") inputs.push(state.tools[block.id], results.get(block.id));
    }
    const old = before.get(`turn-${segment.start}`);
    const oldInputs = old && inputsOf.get(old);
    const same = oldInputs?.length === inputs.length && oldInputs.every((input, j) => input === inputs[j]);
    const turn = same ? old! : buildTurn(segment, state, results, live, runs);
    inputsOf.set(turn, inputs);
    entries.push({ kind: "turn", turn });
  });
  return entries;
}

/** Remembers its last result, so each call reuses the turns that did not change. */
export function transcriptBuilder(): (state: TranscriptState) => TranscriptEntry[] {
  let last: TranscriptEntry[] = [];
  return (state) => (last = buildTranscript(state, last));
}

function buildTurn(segment: Segment, state: TranscriptState, results: Map<string, ToolResultMessage>, running: boolean, runs: TranscriptState["runs"]): Turn {
  const turn: Turn = { key: `turn-${segment.start}`, user: segment.user, pending: segment.pending, activity: [], running: false };
  const draft: Draft = { turn, messages: segment.messages, textItems: new Map() };
  for (const { index, message } of segment.messages) {
    if (message.role === "assistant") addAssistant(draft, message, index, state, results);
    else turn.activity.push({ kind: "message", key: `message-${index}`, message });
  }
  finishTurn(draft, running, runs);
  return turn;
}

function addAssistant(draft: Draft, message: AssistantMessage, index: number, state: TranscriptState, results: Map<string, ToolResultMessage>) {
  const { activity } = draft.turn;
  const texts: ActivityItem[] = [];
  const pushRow = (row: ActivityRow) => {
    const last = activity.at(-1);
    if (last?.kind === "rows") last.rows.push(row);
    else activity.push({ kind: "rows", key: row.key, rows: [row], summary: "" });
  };
  message.content.forEach((block, blockIndex) => {
    const key = `${index}-${blockIndex}`;
    switch (block.type) {
      case "text":
        if (!block.text.trim()) return;
        texts.push({ kind: "text", key, text: block.text });
        activity.push(texts.at(-1)!);
        return;
      case "thinking": {
        if (block.redacted || !block.thinking.trim()) return;
        const live = state.streaming === message && blockIndex === message.content.length - 1;
        const preview = block.thinking.trim().split("\n")[0]!;
        pushRow({ key, verb: "thought", label: live ? rowLabel("thought", "", true) : preview, status: live ? "running" : "done", input: block.thinking });
        return;
      }
      case "toolCall": {
        const result = results.get(block.id);
        const execution = state.tools[block.id];
        const status = result ? (result.isError ? "error" : "done") : (execution?.status ?? (state.streaming === message ? "running" : "done"));
        const verb = toolVerb(block.name);
        const fullOutput = result ? resultText(result) : execution?.output;
        const output = fullOutput && fullOutput.length > MAX_OUTPUT_CHARS ? `${fullOutput.slice(0, MAX_OUTPUT_CHARS)}\n…` : fullOutput;
        pushRow({
          key,
          verb,
          label: rowLabel(verb, toolTarget(block.name, block.arguments), status === "running"),
          status,
          input: block.name === "bash" && typeof block.arguments.command === "string" ? block.arguments.command : JSON.stringify(block.arguments, null, 2),
          output,
          ...fileView(block, result, output),
        });
        return;
      }
      default:
        activity.push({ kind: "unknown", key, value: block });
    }
  });
  draft.textItems.set(index, texts);
}

/** The diff of an edit, the content of a write, or the text of a read; failed or unrecognised calls keep the raw view. */
function fileView(call: ToolCall, result: ToolResultMessage | undefined, output: string | undefined): Pick<ActivityRow, "changes" | "view"> {
  const { path, content } = call.arguments;
  if (typeof path !== "string" || result?.isError) return {};
  switch (call.name) {
    case "edit": {
      const lines = result && parseEditDiff(result.details);
      return lines ? { view: { kind: "diff", path, lines }, changes: countChanges(lines) } : {};
    }
    case "write":
      if (typeof content !== "string") return {};
      return { view: { kind: "code", path, code: content }, changes: result ? { added: lineCount(content), removed: 0 } : undefined };
    case "read":
      return output ? { view: { kind: "code", path, code: output } } : {};
    default:
      return {};
  }
}

function finishTurn(draft: Draft, running: boolean, runs: TranscriptState["runs"]) {
  const { turn } = draft;
  turn.running = running;
  for (const item of turn.activity) if (item.kind === "rows") item.summary = summarize(item.rows.map((row) => row.verb));

  const last = [...draft.messages].reverse().find(({ message }) => message.role === "assistant");
  if (last?.message.role === "assistant") {
    const assistant = last.message;
    const texts = draft.textItems.get(last.index) ?? [];
    if (texts.length > 0 && !assistant.content.some((block) => block.type === "toolCall")) {
      turn.activity = turn.activity.filter((item) => !texts.includes(item));
      turn.answer = texts.map((item) => (item.kind === "text" ? item.text : "")).join("\n\n");
    }
    if (assistant.stopReason === "error") turn.notice = { tone: "error", text: assistant.errorMessage ?? "Pi stopped with an error." };
    else if (assistant.stopReason === "aborted" && !running) turn.notice = { tone: "muted", text: "Stopped" };
  }

  const first = runs[0];
  if (first) {
    turn.startedAt = first.startedAt;
    const end = runs.at(-1)!.endedAt;
    if (end !== undefined && !running) turn.durationMs = end - first.startedAt;
  } else if (!running) {
    // Restored history has no run timing; message timestamps bound it from below.
    const lastAt = draft.messages.at(-1)?.message.timestamp;
    if (typeof lastAt === "number" && lastAt > turn.user.timestamp) turn.durationMs = lastAt - turn.user.timestamp;
  }
  if (running && turn.startedAt === undefined) turn.startedAt = turn.user.timestamp;
}

/** "6m 26s", "12s", "1h 4m". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
