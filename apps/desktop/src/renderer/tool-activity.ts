import type { ApplePiMessage, JsonValue, ToolResultContentPart } from "@apple-pi/protocol";

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

function toolSummary(argumentsValue: Record<string, JsonValue>): string {
  for (const key of ["command", "path", "query", "url"]) {
    if (typeof argumentsValue[key] === "string") return argumentsValue[key];
  }
  return Object.values(argumentsValue).find((value): value is string => typeof value === "string") ?? "";
}

function outputParts(result: ToolResultContentPart): ToolOutputPart[] {
  return result.output.map((part) => part.type === "text"
    ? { kind: "text", text: part.text }
    : { kind: "image", data: part.data, mimeType: part.mimeType });
}

export function toTimelineItems(messages: ApplePiMessage[]): TimelineItem[] {
  const results = new Map<string, ToolResultContentPart>();
  for (const message of messages) {
    if (message.role === "tool") for (const result of message.content) results.set(result.toolCallId, result);
  }

  const items: TimelineItem[] = [];
  for (const message of messages) {
    if (message.role === "tool") continue;
    if (message.role === "user") {
      const text = message.content.map((part) => part.text).filter(Boolean).join("\n");
      if (text) items.push({ kind: "message", role: "user", text });
      continue;
    }

    for (const part of message.content) {
      if (part.type === "text" && part.text) items.push({ kind: "message", role: "assistant", text: part.text });
      if (part.type !== "tool_call") continue;
      const result = results.get(part.id);
      items.push({
        kind: "tool",
        id: part.id,
        name: part.name,
        summary: toolSummary(part.arguments),
        argumentsText: JSON.stringify(part.arguments, null, 2),
        outputParts: result ? outputParts(result) : [],
        status: !result ? "running" : result.isError ? "error" : "success",
      });
    }
  }
  return items;
}
