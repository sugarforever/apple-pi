import type { AssistantContent, AssistantMessage, ToolCall, ToolResultMessage, UserMessage } from "../pi/types.js";

/*
 * Builders for synthetic Pi messages, shared by reducer tests and visual
 * fixtures. Content is invented; nothing here comes from a real session.
 */

const usage: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const user = (text: string, timestamp: number): UserMessage => ({ role: "user", content: text, timestamp });

export const assistant = (content: AssistantContent[], timestamp: number, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage => ({
  role: "assistant",
  content,
  api: "anthropic-messages",
  provider: "anthropic",
  model: "fixture-model",
  usage,
  stopReason,
  timestamp,
});

export const text = (value: string): AssistantContent => ({ type: "text", text: value });
export const thinking = (value: string): AssistantContent => ({ type: "thinking", thinking: value });
export const toolCall = (id: string, name: string, args: ToolCall["arguments"]): ToolCall => ({ type: "toolCall", id, name, arguments: args });

export const toolResult = (call: ToolCall, output: string, timestamp: number, isError = false): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: call.id,
  toolName: call.name,
  content: [{ type: "text", text: output }],
  isError,
  timestamp,
});
