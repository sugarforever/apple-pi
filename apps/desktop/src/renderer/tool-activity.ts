import type { ApplePiMessage, JsonValue, ToolOutputPart as ProtocolToolOutputPart, ToolResultContentPart } from "@apple-pi/protocol";

type MessageItem = { kind: "message"; role: "user" | "assistant"; text: string };
export type ToolStatus = "running" | "success" | "error";
export type ToolOutputPart = { kind: "text"; text: string } | { kind: "image"; data: string; mimeType: string };
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

const unreachable = (value: never): never => {
  throw new Error(`Unhandled Apple Pi discriminator: ${String(value)}`);
};
type AssistantContentPart = Extract<ApplePiMessage, { role: "assistant" }>["content"][number];

function toolSummary(argumentsValue: Record<string, JsonValue>): string {
  for (const key of ["command", "path", "query", "url"]) {
    if (typeof argumentsValue[key] === "string") return argumentsValue[key];
  }
  return Object.values(argumentsValue).find((value): value is string => typeof value === "string") ?? "";
}

function outputPart(part: ProtocolToolOutputPart): ToolOutputPart {
  switch (part.type) {
    case "text":
      return { kind: "text", text: part.text };
    case "image":
      return { kind: "image", data: part.data, mimeType: part.mimeType };
    default:
      return unreachable(part);
  }
}

function projectAssistantPart(part: AssistantContentPart, results: Map<string, ToolResultContentPart>): TimelineItem[] {
  switch (part.type) {
    case "text":
      return part.text ? [{ kind: "message", role: "assistant", text: part.text }] : [];
    case "thinking":
      return [];
    case "tool_call": {
      const result = results.get(part.id);
      return [
        {
          kind: "tool",
          id: part.id,
          name: part.name,
          summary: toolSummary(part.arguments),
          argumentsText: JSON.stringify(part.arguments, null, 2),
          outputParts: result ? result.output.map(outputPart) : [],
          status: !result ? "running" : result.isError ? "error" : "success",
        },
      ];
    }
    default:
      return unreachable(part);
  }
}

export function toTimelineItems(messages: ApplePiMessage[]): TimelineItem[] {
  const results = new Map<string, ToolResultContentPart>();
  for (const message of messages) {
    switch (message.role) {
      case "user":
      case "assistant":
        break;
      case "tool":
        for (const result of message.content) results.set(result.toolCallId, result);
        break;
      default:
        unreachable(message);
    }
  }

  const items: TimelineItem[] = [];
  for (const message of messages) {
    switch (message.role) {
      case "user": {
        const text = message.content
          .map((part) => part.text)
          .filter(Boolean)
          .join("\n");
        if (text) items.push({ kind: "message", role: "user", text });
        break;
      }
      case "assistant":
        for (const part of message.content) items.push(...projectAssistantPart(part, results));
        break;
      case "tool":
        break;
      default:
        unreachable(message);
    }
  }
  return items;
}
