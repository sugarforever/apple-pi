import { describe, expect, it } from "vitest";
import type { PiProcessEvent } from "../../../shared/pi-api.js";
import { assistant, text, user } from "../fixtures/sample-messages.js";
import { initialTranscript, isRunning, reduceTranscript, type TranscriptAction, type TranscriptState } from "./reducer.js";

const run = (events: PiProcessEvent[], state: TranscriptState = initialTranscript): TranscriptState =>
  events.reduce((current, event, index) => reduceTranscript(current, { type: "event", event, at: 1000 + index * 1000 }), state);

const usage = assistant([], 0).usage;
const update = (assistantMessageEvent: Extract<PiProcessEvent, { type: "message_update" }>["assistantMessageEvent"]): PiProcessEvent => ({
  type: "message_update",
  usage,
  assistantMessageEvent,
});

describe("reduceTranscript", () => {
  it("rebuilds a streaming assistant message from deltas and takes message_end as final", () => {
    const final = assistant([text("Hello world")], 5);
    const streaming = run([
      { type: "message_start", message: assistant([], 5, "pending") },
      update({ type: "text_start", contentIndex: 0 }),
      update({ type: "text_delta", contentIndex: 0, delta: "Hello" }),
      update({ type: "text_delta", contentIndex: 0, delta: " wor" }),
      update({ type: "toolcall_start", contentIndex: 1, id: "call-1", toolName: "bash" }),
    ]);
    expect(streaming.streaming?.content).toEqual([
      { type: "text", text: "Hello wor" },
      { type: "toolCall", id: "call-1", name: "bash", arguments: {} },
    ]);

    const done = run([{ type: "message_end", message: final }], streaming);
    expect(done.streaming).toBeUndefined();
    expect(done.messages).toEqual([final]);
  });

  it("tracks tool execution status and output by call id", () => {
    const state = run([
      { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "ls" } },
      { type: "tool_execution_update", toolCallId: "call-1", toolName: "bash", args: {}, partialResult: { content: [{ type: "text", text: "a" }] } },
    ]);
    expect(state.tools["call-1"]).toEqual({ status: "running", output: "a" });
    const ended = run(
      [{ type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: { content: [{ type: "text", text: "a\nb" }] }, isError: true }],
      state,
    );
    expect(ended.tools["call-1"]).toEqual({ status: "error", output: "a\nb" });
  });

  it("times a run from agent_start until Pi settles", () => {
    const started = run([{ type: "agent_start" }, { type: "message_end", message: user("hi", 1) }]);
    expect(isRunning(started)).toBe(true);
    expect(started.runs).toEqual([{ messageIndex: 0, startedAt: 1000 }]);

    const settled = reduceTranscript(started, { type: "event", event: { type: "agent_settled" }, at: 9000 });
    expect(isRunning(settled)).toBe(false);
    expect(settled.runs).toEqual([{ messageIndex: 0, startedAt: 1000, endedAt: 9000 }]);
  });

  it("shows a sent prompt until Pi echoes it as a user message", () => {
    const sent = reduceTranscript(initialTranscript, { type: "prompt_sent", text: "hi", at: 1 });
    expect(sent.pendingPrompt).toEqual({ text: "hi", at: 1 });
    expect(isRunning(sent)).toBe(true);
    expect(run([{ type: "message_end", message: user("hi", 2) }], sent).pendingPrompt).toBeUndefined();
  });

  it("keeps a half-streamed message and closes the run when Pi exits", () => {
    const state = run([{ type: "agent_start" }, { type: "message_start", message: assistant([text("partial")], 2, "pending") }]);
    const exited = reduceTranscript(state, { type: "exited", at: 7000 });
    expect(exited.messages).toHaveLength(1);
    expect(exited.streaming).toBeUndefined();
    expect(exited.runs.at(-1)?.endedAt).toBe(7000);
  });

  it("restores history and resumes a live run", () => {
    const action: TranscriptAction = { type: "restored", messages: [user("hi", 1)], isStreaming: true, at: 50 };
    const state = reduceTranscript({ ...initialTranscript, error: "old" }, action);
    expect(state.messages).toHaveLength(1);
    expect(state.error).toBeUndefined();
    expect(state.runs).toEqual([{ messageIndex: 1, startedAt: 50 }]);
  });

  it("ignores events it does not render, including unknown ones", () => {
    const events = [
      { type: "turn_start" },
      { type: "extension_ui_request", id: "ui-1", method: "notify", message: "hello" },
      { type: "extension_error", extensionPath: "/x.ts", event: "tool_call", error: "boom" },
      { type: "event_from_the_future", payload: 1 },
    ] as unknown as PiProcessEvent[];
    expect(run(events)).toEqual(initialTranscript);
  });

  it("does not break on deltas for content it has not seen start", () => {
    const state = run([
      { type: "message_start", message: assistant([], 1, "pending") },
      update({ type: "text_delta", contentIndex: 2, delta: "late" }),
      update({ type: "toolcall_delta", contentIndex: 0, delta: '{"comm' }),
    ]);
    expect(state.streaming?.content[2]).toEqual({ type: "text", text: "late" });
  });
});
