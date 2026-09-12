import { describe, expect, it } from "vitest";
import { mapPiEvent, mapPiMessages, mapPiModel, mapPiSessionItem } from "./mappers.js";

describe("Pi boundary mappers", () => {
  it("maps Pi messages without exposing Pi fields", () => {
    expect(mapPiMessages([
      { role: "user", content: "Hello", timestamp: 1 },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Inspect" },
          { type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
          { type: "text", text: "Done" },
        ],
        provider: "openai",
        model: "gpt-5",
        usage: {},
        stopReason: "stop",
        timestamp: 2,
      },
      { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "# Apple Pi" }], details: { piOnly: true }, isError: false, timestamp: 3 },
    ])).toEqual([
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [
        { type: "thinking", text: "Inspect" },
        { type: "tool_call", id: "call-1", name: "read", arguments: { path: "README.md" } },
        { type: "text", text: "Done" },
      ] },
      { role: "tool", content: [{ type: "tool_result", toolCallId: "call-1", name: "read", output: [{ type: "text", text: "# Apple Pi" }], isError: false }] },
    ]);
  });

  it.each([
    [{ type: "agent_start" }, { type: "lifecycle", phase: "started" }],
    [{ type: "agent_end", messages: [], willRetry: false }, { type: "lifecycle", phase: "completed" }],
    [{ type: "agent_end", messages: [{ role: "assistant", stopReason: "aborted" }], willRetry: false }, { type: "lifecycle", phase: "cancelled" }],
    [{ type: "agent_end", messages: [{ role: "assistant", stopReason: "error", errorMessage: "Provider unavailable" }], willRetry: false }, { type: "lifecycle", phase: "failed", message: "Provider unavailable" }],
    [{ type: "agent_end", messages: [], willRetry: true }, { type: "resync_required", reason: "Pi agent scheduled a retry" }],
    [{ type: "message_update", message: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hi", partial: {} } }, { type: "text_delta", text: "Hi" }],
    [{ type: "message_update", message: {}, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Hmm", partial: {} } }, { type: "thinking_delta", text: "Hmm" }],
    [{ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "pwd" } }, { type: "tool_call", phase: "started", id: "call-1", name: "bash", arguments: { command: "pwd" } }],
    [{ type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: { content: [{ type: "text", text: "/tmp" }] }, isError: false }, { type: "tool_result", id: "call-1", name: "bash", output: [{ type: "text", text: "/tmp" }], isError: false }],
    [{ type: "queue_update", steering: [], followUp: [] }, { type: "resync_required", reason: "Unsupported Pi event: queue_update" }],
  ])("maps a Pi event into an Apple Pi event", (input, expected) => {
    expect(mapPiEvent(input)).toEqual(expected);
  });

  it("maps model and session summaries", () => {
    expect(mapPiModel({ provider: "openai", id: "gpt-5", name: "GPT-5", piOnly: true })).toEqual({ provider: "openai", modelId: "gpt-5", name: "GPT-5" });
    expect(mapPiSessionItem({ id: "s1", path: "/tmp/s1.jsonl", name: "First", firstMessage: "fallback", created: new Date("2026-09-12T10:00:00.000Z"), modified: new Date("2026-09-12T10:01:00.000Z"), messageCount: 2 })).toEqual({ id: "s1", path: "/tmp/s1.jsonl", name: "First", created: "2026-09-12T10:00:00.000Z", modified: "2026-09-12T10:01:00.000Z", messageCount: 2 });
  });

  it("uses explicit safe fallbacks for unsupported Pi values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(mapPiEvent({ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { timeout: 1n, score: Number.NaN, cyclic, date: new Date("2026-09-12T10:00:00.000Z"), map: new Map() } })).toEqual({
      type: "tool_call",
      phase: "started",
      id: "call-1",
      name: "bash",
      arguments: { timeout: "1", score: "[Unsupported number: NaN]", cyclic: { self: "[Circular Pi value]" }, date: "[Unsupported Pi object: Date]", map: "[Unsupported Pi object: Map]" },
    });
    expect(mapPiEvent({ type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: { content: [{ type: "audio", data: "ignored" }] }, isError: false })).toEqual({
      type: "tool_result",
      id: "call-1",
      name: "bash",
      output: [{ type: "text", text: "[Unsupported Pi tool output: audio]" }],
      isError: false,
    });
    expect(mapPiEvent({ type: "tool_execution_end", toolCallId: "call-2", toolName: "read", result: {}, isError: false })).toEqual({
      type: "tool_result",
      id: "call-2",
      name: "read",
      output: [{ type: "text", text: "[Unsupported Pi tool output container]" }],
      isError: false,
    });
    expect(mapPiMessages([{ role: "custom", content: "Internal notice", timestamp: 1 }])).toEqual([]);
  });
});
