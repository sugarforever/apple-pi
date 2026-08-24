type MessageItem = { kind: "message"; role: "user" | "assistant"; text: string };
export type ToolStatus = "running" | "success" | "error";
export type ToolOutputPart =
  | { kind: "text"; text: string }
  | { kind: "image"; data: string; mimeType: string };
export type ToolItem = {
  kind: "tool";
  id: string;
  name: string;
  summary: string;
  argumentsText: string;
  outputParts: ToolOutputPart[];
  status: ToolStatus;
};
export type TimelineItem = MessageItem | ToolItem;

type ContentPart = { type?: unknown; text?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
type MessageRecord = {
  role?: unknown;
  content?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  isError?: unknown;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const record = asRecord(part);
      return record?.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function toolOutput(content: unknown): ToolOutputPart[] {
  if (typeof content === "string") return [{ kind: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part): ToolOutputPart[] => {
    const record = asRecord(part);
    if (record?.type === "text" && typeof record.text === "string") return [{ kind: "text", text: record.text }];
    if (record?.type === "image" && typeof record.data === "string" && typeof record.mimeType === "string" && record.mimeType.startsWith("image/")) {
      return [{ kind: "image", data: record.data, mimeType: record.mimeType }];
    }
    return [];
  });
}

function toolSummary(argumentsValue: unknown): string {
  const record = asRecord(argumentsValue);
  if (!record) return "";
  for (const key of ["command", "path", "query", "url"]) {
    if (typeof record[key] === "string") return record[key];
  }
  const firstString = Object.values(record).find((value) => typeof value === "string");
  return typeof firstString === "string" ? firstString : "";
}

function formattedArguments(value: unknown): string {
  if (value === undefined) return "";
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
}

export function toTimelineItems(messages: unknown[]): TimelineItem[] {
  const results = new Map<string, MessageRecord>();
  for (const message of messages) {
    const record = asRecord(message) as MessageRecord | undefined;
    if (record?.role === "toolResult" && typeof record.toolCallId === "string") results.set(record.toolCallId, record);
  }

  const items: TimelineItem[] = [];
  for (const message of messages) {
    const record = asRecord(message) as MessageRecord | undefined;
    if (!record || record.role === "toolResult") continue;

    if (record.role === "user") {
      const text = textContent(record.content);
      if (text) items.push({ kind: "message", role: "user", text });
      continue;
    }

    if (record.role !== "assistant") continue;
    if (typeof record.content === "string") {
      if (record.content) items.push({ kind: "message", role: "assistant", text: record.content });
      continue;
    }
    if (!Array.isArray(record.content)) continue;

    for (const rawPart of record.content) {
      const part = rawPart as ContentPart;
      if (part.type === "text" && typeof part.text === "string" && part.text) {
        items.push({ kind: "message", role: "assistant", text: part.text });
      }
      if (part.type !== "toolCall" || typeof part.id !== "string") continue;
      const result = results.get(part.id);
      items.push({
        kind: "tool",
        id: part.id,
        name: typeof part.name === "string" ? part.name : typeof result?.toolName === "string" ? result.toolName : "tool",
        summary: toolSummary(part.arguments),
        argumentsText: formattedArguments(part.arguments),
        outputParts: result ? toolOutput(result.content) : [],
        status: !result ? "running" : result.isError ? "error" : "success",
      });
    }
  }
  return items;
}
