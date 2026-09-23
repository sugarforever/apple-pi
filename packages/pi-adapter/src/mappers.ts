import {
  decodeApplePiMessage,
  decodeApplePiSessionEvent,
  decodeModelItem,
  decodeProviderAuthEvent,
  decodeSessionItem,
  decodeSkillDiagnostic,
  decodeSkillItem,
  type ApplePiContentPart,
  type ApplePiMessage,
  type ApplePiSessionEvent,
  type JsonValue,
  type ModelItem,
  type ProviderAuthEvent,
  type SessionItem,
  type SkillDiagnostic,
  type SkillItem,
  type ToolOutputPart,
} from "@apple-pi/protocol";
import type { ResourceDiagnostic, Skill } from "@earendil-works/pi-coding-agent";

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

const printable = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" ? String(value) : "unknown";

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

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
    if (item?.type === "image" && typeof item.data === "string" && nonEmptyString(item.mimeType)) {
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
    if (role === "assistant" && item?.type === "toolCall" && nonEmptyString(item.id) && nonEmptyString(item.name)) {
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
    if (item?.role === "toolResult" && nonEmptyString(item.toolCallId) && nonEmptyString(item.toolName)) {
      return [
        decodeApplePiMessage({
          role: "tool",
          content: [
            { type: "tool_result", toolCallId: item.toolCallId, name: item.toolName, output: outputParts(item.content), isError: item.isError === true },
          ],
        }),
      ];
    }
    return [];
  });
}

export function mapPiEvent(value: unknown): ApplePiSessionEvent {
  const event = record(value);
  let mapped: ApplePiSessionEvent;
  switch (event?.type) {
    case "agent_start":
      mapped = { type: "lifecycle", phase: "started" };
      break;
    case "agent_end": {
      if (event.willRetry === true) {
        mapped = { type: "resync_required", reason: "Pi agent scheduled a retry" };
        break;
      }
      const messages = Array.isArray(event.messages) ? event.messages : [];
      const assistant = [...messages]
        .reverse()
        .map(record)
        .find((message) => message?.role === "assistant");
      if (assistant?.stopReason === "aborted") mapped = { type: "lifecycle", phase: "cancelled" };
      else if (assistant?.stopReason === "error")
        mapped = { type: "lifecycle", phase: "failed", ...(typeof assistant.errorMessage === "string" ? { message: assistant.errorMessage } : {}) };
      else mapped = { type: "lifecycle", phase: "completed" };
      break;
    }
    case "message_update": {
      const update = record(event.assistantMessageEvent);
      if (update?.type === "text_delta" && typeof update.delta === "string") mapped = { type: "text_delta", text: update.delta };
      else if (update?.type === "thinking_delta" && typeof update.delta === "string") mapped = { type: "thinking_delta", text: update.delta };
      else if (update?.type === "toolcall_start" || update?.type === "toolcall_delta" || update?.type === "toolcall_end") {
        const toolCall = streamedToolCall(update);
        mapped =
          nonEmptyString(toolCall?.id) && nonEmptyString(toolCall.name)
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
      mapped = { type: "resync_required", reason: `Pi tool execution started: ${printable(event.toolName)}` };
      break;
    case "tool_execution_update":
      mapped = { type: "resync_required", reason: `Pi tool execution updated: ${printable(event.toolName)}` };
      break;
    case "tool_execution_end": {
      const result = record(event.result);
      mapped =
        nonEmptyString(event.toolCallId) && nonEmptyString(event.toolName)
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
      else if (event.result === undefined) mapped = { type: "resync_required", reason: `Pi compaction failed (${reason})${detail}` };
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
    case "summarization_retry_scheduled":
      mapped = {
        type: "resync_required",
        reason: `Pi summarization retry ${printable(event.attempt)}/${printable(event.maxAttempts)} scheduled in ${printable(event.delayMs)}ms${typeof event.errorMessage === "string" ? `: ${event.errorMessage}` : ""}`,
      };
      break;
    case "summarization_retry_attempt_start":
      mapped =
        event.source === "compaction"
          ? { type: "resync_required", reason: `Pi compaction summarization retry started (${printable(event.reason)})` }
          : event.source === "branchSummary"
            ? { type: "resync_required", reason: "Pi branch summary retry started" }
            : { type: "resync_required", reason: "Pi summarization retry started" };
      break;
    case "summarization_retry_finished":
      mapped = { type: "resync_required", reason: "Pi summarization retry finished" };
      break;
    default:
      mapped = { type: "resync_required", reason: `Unsupported Pi event: ${printable(event?.type)}` };
  }
  return decodeApplePiSessionEvent(mapped);
}

export function mapPiModel(value: unknown): ModelItem {
  const item = record(value);
  return decodeModelItem({ provider: item?.provider, modelId: item?.id, name: item?.name || item?.id });
}

// Maps a Pi `AuthEvent` (from `AuthInteraction.notify()`) to Apple Pi's wire
// shape. Never carries a token: `auth_url`/`device_code` are public onboarding
// artifacts by construction (see `@earendil-works/pi-ai`'s `AuthEvent`).
export function mapPiAuthEvent(value: unknown): ProviderAuthEvent {
  const event = record(value);
  switch (event?.type) {
    case "info":
      return decodeProviderAuthEvent({
        type: "info",
        message: printable(event.message),
        ...(Array.isArray(event.links) ? { links: authLinks(event.links) } : {}),
      });
    case "auth_url":
      return decodeProviderAuthEvent({
        type: "auth_url",
        url: printable(event.url),
        ...(nonEmptyString(event.instructions) ? { instructions: event.instructions } : {}),
      });
    case "device_code":
      return decodeProviderAuthEvent({
        type: "device_code",
        userCode: printable(event.userCode),
        verificationUri: printable(event.verificationUri),
        ...(typeof event.intervalSeconds === "number" ? { intervalSeconds: event.intervalSeconds } : {}),
        ...(typeof event.expiresInSeconds === "number" ? { expiresInSeconds: event.expiresInSeconds } : {}),
      });
    case "progress":
      return decodeProviderAuthEvent({ type: "progress", message: printable(event.message) });
    default:
      return decodeProviderAuthEvent({ type: "progress", message: `Unsupported Pi auth event: ${printable(event?.type)}` });
  }
}

function authLinks(value: unknown[]): Array<{ url: string; label?: string }> {
  return value.flatMap((link) => {
    const item = record(link);
    return nonEmptyString(item?.url) ? [{ url: item.url, ...(nonEmptyString(item.label) ? { label: item.label } : {}) }] : [];
  });
}

// Maps a Pi `AuthPrompt` (from `AuthInteraction.prompt()`) to a `provider.authEvent`
// of type "prompt". `promptId` is Apple Pi's own correlation id (the real
// `AuthPrompt` has no id, only a non-serializable per-prompt `AbortSignal`);
// `provider.respondOAuthPrompt` answers a specific prompt by this id.
export function mapPiAuthPrompt(promptId: string, value: unknown): ProviderAuthEvent {
  const prompt = record(value);
  const placeholder = nonEmptyString(prompt?.placeholder) ? { placeholder: prompt.placeholder } : {};
  switch (prompt?.type) {
    case "secret":
      return decodeProviderAuthEvent({ type: "prompt", prompt: { type: "secret", promptId, message: printable(prompt.message), ...placeholder } });
    case "select":
      return decodeProviderAuthEvent({
        type: "prompt",
        prompt: { type: "select", promptId, message: printable(prompt.message), options: authSelectOptions(prompt.options) },
      });
    case "manual_code":
      return decodeProviderAuthEvent({ type: "prompt", prompt: { type: "manual_code", promptId, message: printable(prompt.message), ...placeholder } });
    case "text":
    default:
      return decodeProviderAuthEvent({
        type: "prompt",
        prompt: { type: "text", promptId, message: printable(prompt?.message ?? "Provide a value to continue signing in."), ...placeholder },
      });
  }
}

function authSelectOptions(value: unknown): Array<{ id: string; label: string; description?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) => {
    const item = record(option);
    return nonEmptyString(item?.id) && nonEmptyString(item.label)
      ? [{ id: item.id, label: item.label, ...(nonEmptyString(item.description) ? { description: item.description } : {}) }]
      : [];
  });
}

export function mapPiSessionItem(value: unknown): SessionItem {
  const item = record(value);
  const explicitName = nonEmptyString(item?.name) ? item.name : "";
  const firstMessage = nonEmptyString(item?.firstMessage) ? item.firstMessage.trim() : "";
  const messageLines = firstMessage
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const firstLine = messageLines[0];
  const fallbackSource = firstLine || "New session";
  const fallbackGraphemes = [...graphemeSegmenter.segment(fallbackSource)].map(({ segment }) => segment);
  const compactFallback = fallbackGraphemes.length > 48 ? `${fallbackGraphemes.slice(0, 47).join("").trimEnd()}…` : fallbackSource;
  const hasMoreMessage = messageLines.length > 1;
  return decodeSessionItem({
    id: item?.id,
    path: item?.path,
    name: explicitName || `${compactFallback}${hasMoreMessage && !compactFallback.endsWith("…") ? "…" : ""}`,
    created: item?.created instanceof Date ? item.created.toISOString() : item?.created,
    modified: item?.modified instanceof Date ? item.modified.toISOString() : item?.modified,
    messageCount: item?.messageCount,
  });
}

// Apple Pi's DefaultResourceLoader is always constructed without
// additionalSkillPaths (see skill-service.ts), so Pi's third `SourceScope`
// value, "temporary" (CLI-only extra directories), is unreachable here;
// anything but "user" is conservatively treated as project-scoped rather
// than crashing the whole catalog.
export function mapPiSkill(skill: Skill): SkillItem {
  return decodeSkillItem({
    name: skill.name,
    description: skill.description,
    scope: skill.sourceInfo.scope === "user" ? "user" : "project",
    path: skill.filePath,
    disableModelInvocation: skill.disableModelInvocation,
    // "auto" means Pi discovered it by scanning the standard managed skills
    // root; "local" (a settings.json skills-array entry) and package-provided
    // skills point elsewhere on disk and are never Apple-Pi-managed.
    managed: skill.sourceInfo.source === "auto",
  });
}

export function mapPiSkillDiagnostic(diagnostic: ResourceDiagnostic): SkillDiagnostic {
  return decodeSkillDiagnostic({
    type: diagnostic.type,
    message: diagnostic.message,
    ...(nonEmptyString(diagnostic.path) ? { path: diagnostic.path } : {}),
    ...(diagnostic.collision
      ? {
          // Sourced from ResourceLoader.getSkills().diagnostics, so this collision
          // is always about a skill; the literal is forced rather than trusted from
          // Pi's broader resourceType union to match our closed schema exactly.
          collision: {
            resourceType: "skill" as const,
            name: diagnostic.collision.name,
            winnerPath: diagnostic.collision.winnerPath,
            loserPath: diagnostic.collision.loserPath,
            ...(nonEmptyString(diagnostic.collision.winnerSource) ? { winnerSource: diagnostic.collision.winnerSource } : {}),
            ...(nonEmptyString(diagnostic.collision.loserSource) ? { loserSource: diagnostic.collision.loserSource } : {}),
          },
        }
      : {}),
  });
}
