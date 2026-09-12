import {
  decodeApplePiMessage,
  decodeApplePiSessionEvent,
  decodeModelItem,
  decodeSessionItem,
  type ApplePiContentPart,
  type ApplePiMessage,
  type ApplePiSessionEvent,
  type JsonValue,
  type ModelItem,
  type SessionItem,
  type ToolOutputPart,
} from "@apple-pi/protocol";

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;

const printable = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
    ? String(value)
    : "unknown";

function jsonObject(value: unknown): Record<string, JsonValue> {
  const mapped = jsonValue(value);
  return mapped !== null && typeof mapped === "object" && !Array.isArray(mapped) ? mapped : { _applePiFallback: mapped };
}

function jsonValue(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : `[Unsupported number: ${String(value)}]`;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return `[Unsupported Pi value: ${typeof value}]`;
  if (ancestors.has(value)) return "[Circular Pi value]";
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return `[Unsupported Pi object: ${value.constructor?.name ?? "unknown"}]`;
  }

  ancestors.add(value);
  const mapped: JsonValue = Array.isArray(value)
    ? value.map((item) => jsonValue(item, ancestors))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, ancestors)]));
  ancestors.delete(value);
  return mapped;
}

function outputParts(value: unknown): ToolOutputPart[] {
  if (!Array.isArray(value)) return [{ type: "text", text: "[Unsupported Pi tool output container]" }];
  return value.flatMap((part): ToolOutputPart[] => {
    const item = record(part);
    if (item?.type === "text" && typeof item.text === "string") return [{ type: "text", text: item.text }];
    if (item?.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
      return [{ type: "image", data: item.data, mimeType: item.mimeType }];
    }
    return [{ type: "text", text: `[Unsupported Pi tool output: ${printable(item?.type)}]` }];
  });
}

function streamedToolCall(update: Record<string, unknown>): Record<string, unknown> | undefined {
  const completed = record(update.toolCall);
  if (completed) return completed;
  const partial = record(update.partial);
  const content = Array.isArray(partial?.content) ? partial.content : [];
  return typeof update.contentIndex === "number" ? record(content[update.contentIndex]) : undefined;
}

function contentParts(value: unknown, role: "user" | "assistant"): ApplePiContentPart[] {
  if (typeof value === "string") return [{ type: "text", text: value }];
  if (!Array.isArray(value)) return [{ type: "text", text: "[Unsupported Pi message content]" }];
  return value.flatMap<ApplePiContentPart>((part) => {
    const item = record(part);
    if (item?.type === "text" && typeof item.text === "string") return [{ type: "text" as const, text: item.text }];
    if (role === "assistant" && item?.type === "thinking" && typeof item.thinking === "string") return [{ type: "thinking" as const, text: item.thinking }];
    if (role === "assistant" && item?.type === "toolCall" && typeof item.id === "string" && typeof item.name === "string") {
      return [{ type: "tool_call" as const, id: item.id, name: item.name, arguments: jsonObject(item.arguments) }];
    }
    if (item?.type === "image" && typeof item.mimeType === "string") return [{ type: "text" as const, text: `[Image omitted: ${item.mimeType}]` }];
    return [{ type: "text" as const, text: "[Unsupported Pi content part]" }];
  });
}

export function mapPiMessages(value: unknown): ApplePiMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message): ApplePiMessage[] => {
    const item = record(message);
    if (item?.role === "user") return [decodeApplePiMessage({ role: "user", content: contentParts(item.content, "user") })];
    if (item?.role === "assistant") return [decodeApplePiMessage({ role: "assistant", content: contentParts(item.content, "assistant") })];
    if (item?.role === "toolResult" && typeof item.toolCallId === "string" && typeof item.toolName === "string") {
      return [decodeApplePiMessage({ role: "tool", content: [{ type: "tool_result", toolCallId: item.toolCallId, name: item.toolName, output: outputParts(item.content), isError: item.isError === true }] })];
    }
    return [];
  });
}

export function mapPiEvent(value: unknown): ApplePiSessionEvent {
  const event = record(value);
  let mapped: ApplePiSessionEvent;
  switch (event?.type) {
    case "agent_start": mapped = { type: "lifecycle", phase: "started" }; break;
    case "agent_end": {
      if (event.willRetry === true) {
        mapped = { type: "resync_required", reason: "Pi agent scheduled a retry" };
        break;
      }
      const messages = Array.isArray(event.messages) ? event.messages : [];
      const assistant = [...messages].reverse().map(record).find((message) => message?.role === "assistant");
      if (assistant?.stopReason === "aborted") mapped = { type: "lifecycle", phase: "cancelled" };
      else if (assistant?.stopReason === "error") mapped = { type: "lifecycle", phase: "failed", ...(typeof assistant.errorMessage === "string" ? { message: assistant.errorMessage } : {}) };
      else mapped = { type: "lifecycle", phase: "completed" };
      break;
    }
    case "message_update": {
      const update = record(event.assistantMessageEvent);
      if (update?.type === "text_delta" && typeof update.delta === "string") mapped = { type: "text_delta", text: update.delta };
      else if (update?.type === "thinking_delta" && typeof update.delta === "string") mapped = { type: "thinking_delta", text: update.delta };
      else if (update?.type === "toolcall_start" || update?.type === "toolcall_delta" || update?.type === "toolcall_end") {
        const toolCall = streamedToolCall(update);
        mapped = typeof toolCall?.id === "string" && typeof toolCall.name === "string"
          ? {
              type: "tool_call",
              phase: update.type === "toolcall_start" ? "started" : update.type === "toolcall_delta" ? "updated" : "completed",
              id: toolCall.id,
              name: toolCall.name,
              arguments: jsonObject(toolCall.arguments),
            }
          : { type: "resync_required", reason: `Malformed Pi message update: ${update.type}` };
      } else mapped = { type: "resync_required", reason: `Unsupported Pi message update: ${printable(update?.type)}` };
      break;
    }
    case "tool_execution_start":
      mapped = typeof event.toolCallId === "string" && typeof event.toolName === "string"
        ? { type: "tool_call", phase: "started", id: event.toolCallId, name: event.toolName, arguments: jsonObject(event.args) }
        : { type: "resync_required", reason: `Malformed Pi event: ${event.type}` };
      break;
    case "tool_execution_update":
      mapped = { type: "resync_required", reason: `Pi tool execution updated: ${printable(event.toolName)}` };
      break;
    case "tool_execution_end": {
      const result = record(event.result);
      mapped = typeof event.toolCallId === "string" && typeof event.toolName === "string"
        ? { type: "tool_result", id: event.toolCallId, name: event.toolName, output: outputParts(result?.content), isError: event.isError === true }
        : { type: "resync_required", reason: "Malformed Pi event: tool_execution_end" };
      break;
    }
    case "queue_update":
      mapped = { type: "resync_required", reason: "Pi queue changed" };
      break;
    case "compaction_start":
      mapped = { type: "resync_required", reason: `Pi compaction started (${printable(event.reason)})` };
      break;
    case "compaction_end": {
      const reason = printable(event.reason);
      const detail = typeof event.errorMessage === "string" ? `: ${event.errorMessage}` : "";
      if (event.willRetry === true) mapped = { type: "resync_required", reason: `Pi compaction will retry (${reason})${detail}` };
      else if (event.aborted === true) mapped = { type: "resync_required", reason: `Pi compaction aborted (${reason})${detail}` };
      else mapped = { type: "resync_required", reason: `Pi compaction completed (${reason})` };
      break;
    }
    case "auto_retry_start":
      mapped = {
        type: "resync_required",
        reason: `Pi retry ${printable(event.attempt)}/${printable(event.maxAttempts)} scheduled in ${printable(event.delayMs)}ms${typeof event.errorMessage === "string" ? `: ${event.errorMessage}` : ""}`,
      };
      break;
    case "auto_retry_end":
      mapped = {
        type: "resync_required",
        reason: `Pi retry ${printable(event.attempt)} ${event.success === true ? "succeeded" : "failed"}${typeof event.finalError === "string" ? `: ${event.finalError}` : ""}`,
      };
      break;
    default: mapped = { type: "resync_required", reason: `Unsupported Pi event: ${printable(event?.type)}` };
  }
  return decodeApplePiSessionEvent(mapped);
}

export function mapPiModel(value: unknown): ModelItem {
  const item = record(value);
  return decodeModelItem({ provider: item?.provider, modelId: item?.id, name: item?.name || item?.id });
}

export function mapPiSessionItem(value: unknown): SessionItem {
  const item = record(value);
  return decodeSessionItem({
    id: item?.id,
    path: item?.path,
    name: item?.name || item?.firstMessage || "New session",
    created: item?.created instanceof Date ? item.created.toISOString() : item?.created,
    modified: item?.modified instanceof Date ? item.modified.toISOString() : item?.modified,
    messageCount: item?.messageCount,
  });
}
