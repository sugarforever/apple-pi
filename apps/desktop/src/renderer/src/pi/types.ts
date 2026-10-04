import type { RpcCommand, RpcResponse } from "@earendil-works/pi-coding-agent";
import type { PiProcessEvent } from "../../../shared/pi-api.js";

export type { EditToolDetails } from "@earendil-works/pi-coding-agent";

/*
 * Pi's package root exports its RPC and event types but not the message and
 * content types they carry, so these aliases reach them through the exported
 * shapes. Nothing here is declared by Apple Pi.
 */

/** Any message in a Pi session: user, assistant, tool result, and Pi's custom roles. */
export type AgentMessage = Extract<RpcResponse, { command: "get_messages"; success: true }>["data"]["messages"][number];
export type UserMessage = Extract<AgentMessage, { role: "user" }>;
export type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
export type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;
export type AssistantContent = AssistantMessage["content"][number];
export type ToolCall = Extract<AssistantContent, { type: "toolCall" }>;
export type UserContent = Exclude<UserMessage["content"], string>[number];

export type SessionState = Extract<RpcResponse, { command: "get_state"; success: true }>["data"];
export type SessionStats = Extract<RpcResponse, { command: "get_session_stats"; success: true }>["data"];

export type AgentEvent = Exclude<PiProcessEvent, { type: "extension_ui_request" }>;
export type AssistantMessageEvent = Extract<AgentEvent, { type: "message_update" }>["assistantMessageEvent"];

export type PromptCommand = Extract<RpcCommand, { type: "prompt" }>;
export type ImageContent = NonNullable<PromptCommand["images"]>[number];
export type Model = Extract<RpcResponse, { command: "get_available_models"; success: true }>["data"]["models"][number];
export type ThinkingLevel = Extract<RpcCommand, { type: "set_thinking_level" }>["level"];
export type SlashCommand = Extract<RpcResponse, { command: "get_commands"; success: true }>["data"]["commands"][number];
