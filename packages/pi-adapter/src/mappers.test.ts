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
    [{ type: "message_update", message: {}, assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: { content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }] } } }, { type: "tool_call", phase: "started", id: "call-1", name: "bash", arguments: {} }],
    [{ type: "message_update", message: {}, assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: '{"command":"pwd"}', partial: { content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } }] } } }, { type: "tool_call", phase: "updated", id: "call-1", name: "bash", arguments: { command: "pwd" } }],
    [{ type: "message_update", message: {}, assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } }, partial: {} } }, { type: "tool_call", phase: "completed", id: "call-1", name: "bash", arguments: { command: "pwd" } }],
    [{ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "pwd" } }, { type: "resync_required", reason: "Pi tool execution started: bash" }],
    [{ type: "tool_execution_update", toolCallId: "call-1", toolName: "bash", args: { command: "pwd" }, partialResult: { content: [{ type: "text", text: "/tm" }] } }, { type: "resync_required", reason: "Pi tool execution updated: bash" }],
    [{ type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: { content: [{ type: "text", text: "/tmp" }] }, isError: false }, { type: "tool_result", id: "call-1", name: "bash", output: [{ type: "text", text: "/tmp" }], isError: false }],
    [{ type: "queue_update", steering: ["Correct course"], followUp: ["Then test"] }, { type: "resync_required", reason: "Pi queue changed" }],
    [{ type: "compaction_start", reason: "threshold" }, { type: "resync_required", reason: "Pi compaction started (threshold)" }],
    [{ type: "compaction_end", reason: "overflow", result: {}, aborted: false, willRetry: false }, { type: "resync_required", reason: "Pi compaction completed (overflow)" }],
    [{ type: "compaction_end", reason: "manual", result: undefined, aborted: true, willRetry: false }, { type: "resync_required", reason: "Pi compaction aborted (manual)" }],
    [{ type: "compaction_end", reason: "overflow", result: undefined, aborted: false, willRetry: true, errorMessage: "Context too large" }, { type: "resync_required", reason: "Pi compaction will retry (overflow): Context too large" }],
    [{ type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 500, errorMessage: "Rate limited" }, { type: "resync_required", reason: "Pi retry 2/3 scheduled in 500ms: Rate limited" }],
    [{ type: "auto_retry_end", success: true, attempt: 2 }, { type: "resync_required", reason: "Pi retry 2 succeeded" }],
    [{ type: "auto_retry_end", success: false, attempt: 3, finalError: "Still unavailable" }, { type: "resync_required", reason: "Pi retry 3 failed: Still unavailable" }],
    [{ type: "future_pi_event", internal: true }, { type: "resync_required", reason: "Unsupported Pi event: future_pi_event" }],
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
    expect(mapPiEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", toolCall: { type: "toolCall", id: "call-1", name: "bash", arguments: { timeout: 1n, score: Number.NaN, cyclic, date: new Date("2026-09-12T10:00:00.000Z"), map: new Map() } } } })).toEqual({
      type: "tool_call",
      phase: "completed",
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

  it("safely degrades an event with an unprintable discriminator", () => {
    expect(mapPiEvent({ type: Object.create(null) })).toEqual({
      type: "resync_required",
      reason: "Unsupported Pi event: unknown",
    });
  });

  it("safely degrades unprintable nested Pi values", () => {
    const unprintable = Object.create(null);
    expect(mapPiEvent({ type: "message_update", assistantMessageEvent: { type: unprintable } })).toEqual({ type: "resync_required", reason: "Unsupported Pi message update: unknown" });
    expect(mapPiEvent({ type: "compaction_start", reason: unprintable })).toEqual({ type: "resync_required", reason: "Pi compaction started (unknown)" });
    expect(mapPiEvent({ type: "auto_retry_start", attempt: unprintable, maxAttempts: unprintable, delayMs: unprintable })).toEqual({ type: "resync_required", reason: "Pi retry unknown/unknown scheduled in unknownms" });
    expect(mapPiEvent({ type: "tool_execution_end", toolCallId: "call-1", toolName: "read", result: { content: [{ type: unprintable }] }, isError: false })).toEqual({
      type: "tool_result",
      id: "call-1",
      name: "read",
      output: [{ type: "text", text: "[Unsupported Pi tool output: unknown]" }],
      isError: false,
    });
  });

  it("keeps a tool-call lifecycle monotonic across generation and execution", () => {
    const events = [
      { type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: { content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }] } } },
      { type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, partial: { content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } }] } } },
      { type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } } } },
      { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "pwd" } },
    ].map(mapPiEvent);

    expect(events.map((event) => event.type === "tool_call" ? event.phase : event.type)).toEqual([
      "started", "updated", "completed", "resync_required",
    ]);
  });

  it("safely resyncs incomplete streamed tool-call identities", () => {
    expect(mapPiEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: { content: [{ type: "toolCall", id: "", name: "bash", arguments: {} }] } } })).toEqual({
      type: "resync_required",
      reason: "Malformed Pi message update: toolcall_start",
    });
    expect(mapPiEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, partial: { content: [{ type: "toolCall", id: "call-1", name: "", arguments: {} }] } } })).toEqual({
      type: "resync_required",
      reason: "Malformed Pi message update: toolcall_delta",
    });
  });
});
