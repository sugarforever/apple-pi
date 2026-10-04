import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../pi/types.js";
import { assistant, text, thinking, toolCall, toolResult, user } from "../fixtures/sample-messages.js";
import { rowLabel, summarize, toolTarget, toolVerb } from "./activity-labels.js";
import { initialTranscript, type TranscriptState } from "./reducer.js";
import { buildTranscript, formatDuration, type Turn } from "./turns.js";

const turnsOf = (state: Partial<TranscriptState>): Turn[] =>
  buildTranscript({ ...initialTranscript, ...state }).flatMap((entry) => (entry.kind === "turn" ? [entry.turn] : []));

const ls = toolCall("c1", "bash", { command: "ls -la\necho done" });
const cat = toolCall("c2", "read", { path: "src/a.ts" });
const grep = toolCall("c3", "grep", { pattern: "TODO" });

describe("buildTranscript", () => {
  it("puts working text and tools under the turn and lifts the last message out as the answer", () => {
    const [turn] = turnsOf({
      messages: [
        user("Fix it", 0),
        assistant([thinking("Look first"), text("Looking around."), ls, cat], 1_000, "toolUse"),
        toolResult(ls, "a\nb", 2_000),
        toolResult(cat, "code", 3_000),
        assistant([text("Checking for leftovers."), grep], 4_000, "toolUse"),
        toolResult(grep, "", 5_000),
        assistant([text("Fixed."), text("All tests pass.")], 66_000),
      ],
    });

    expect(turn!.answer).toBe("Fixed.\n\nAll tests pass.");
    expect(turn!.activity.map((item) => (item.kind === "rows" ? item.summary : item.kind))).toEqual([
      "Thought",
      "text",
      "Ran a command, read a file",
      "text",
      "Searched the code",
    ]);
    const rows = turn!.activity.flatMap((item) => (item.kind === "rows" ? item.rows : []));
    expect(rows.map((row) => row.label)).toEqual(["Look first", "Ran ls -la", "Read src/a.ts", "Searched for TODO"]);
    expect(rows[1]).toMatchObject({ status: "done", input: "ls -la\necho done", output: "a\nb" });
    // Restored history has no run timing, so message timestamps give the duration.
    expect(turn!.durationMs).toBe(66_000);
  });

  it("keeps a turn that ended on tool calls without an answer, and reports errors", () => {
    const [turn] = turnsOf({
      messages: [user("Go", 0), { ...assistant([ls], 1, "error"), errorMessage: "rate limited" }],
    });
    expect(turn!.answer).toBeUndefined();
    expect(turn!.notice).toEqual({ tone: "error", text: "rate limited" });
  });

  it("marks the last turn running with live tool status and run timing", () => {
    const [first, second] = turnsOf({
      messages: [user("One", 0), assistant([text("Done")], 10), user("Two", 20)],
      streaming: assistant([text("On it."), ls], 30, "pending"),
      tools: { c1: { status: "running", output: "partial" } },
      runs: [
        { messageIndex: 0, startedAt: 100, endedAt: 4_100 },
        { messageIndex: 2, startedAt: 5_000 },
      ],
    });
    expect(first).toMatchObject({ running: false, durationMs: 4_000, answer: "Done" });
    expect(second).toMatchObject({ running: true, startedAt: 5_000 });
    expect(second!.durationMs ?? second!.answer).toBeUndefined();
    const row = second!.activity.flatMap((item) => (item.kind === "rows" ? item.rows : []))[0];
    expect(row).toMatchObject({ status: "running", label: "Running ls -la", output: "partial" });
  });

  it("shows a pending prompt as a running turn", () => {
    const [turn] = turnsOf({ pendingPrompt: { text: "Hello", at: 9 } });
    expect(turn).toMatchObject({ pending: true, running: true, startedAt: 9, user: { content: "Hello" } });
  });

  it("renders unknown roles and content generically instead of failing", () => {
    const future = { role: "hologram", timestamp: 3 } as unknown as AgentMessage;
    const strange = { type: "audio", data: "…" } as unknown as ReturnType<typeof text>;
    const entries = buildTranscript({
      ...initialTranscript,
      messages: [
        { role: "compactionSummary", summary: "Earlier work", tokensBefore: 10, timestamp: 0 },
        user("Hi", 1),
        future,
        assistant([strange, text("ok")], 4),
      ],
    });
    expect(entries[0]).toMatchObject({ kind: "message", message: { role: "compactionSummary" } });
    const turn = entries[1]?.kind === "turn" ? entries[1].turn : undefined;
    expect(turn?.activity.map((item) => item.kind)).toEqual(["message", "unknown"]);
    expect(turn?.answer).toBe("ok");
  });
});

describe("activity labels", () => {
  it("names built-in tools and falls back to the tool name", () => {
    expect(rowLabel(toolVerb("write"), toolTarget("write", { path: "a.md" }), false)).toBe("Wrote a.md");
    expect(rowLabel(toolVerb("edit"), toolTarget("edit", { path: "b.ts" }), true)).toBe("Editing b.ts");
    expect(rowLabel(toolVerb("ls"), toolTarget("ls", {}), false)).toBe("Listed .");
    expect(rowLabel(toolVerb("web_search"), toolTarget("web_search", { query: "pi" }), false)).toBe("Used web_search");
    expect(toolTarget("bash", null)).toBe("a command");
  });

  it("summarizes a group by verb in order of first appearance", () => {
    expect(summarize(["ran", "read", "ran", "used"])).toBe("Ran 2 commands, read a file, used a tool");
  });

  it("formats durations", () => {
    expect([formatDuration(400), formatDuration(12_000), formatDuration(386_000), formatDuration(3_900_000)]).toEqual(["0s", "12s", "6m 26s", "1h 5m"]);
  });
});

describe("file views", () => {
  it("shows an edit's diff and a write's content with line counts, and the raw view for a failed edit", () => {
    const edit = toolCall("e1", "edit", { path: "src/a.ts", edits: [] });
    const write = toolCall("w1", "write", { path: "src/b.ts", content: "one\ntwo\n" });
    const failed = toolCall("e2", "edit", { path: "src/c.ts", edits: [] });
    const [turn] = turnsOf({
      messages: [
        user("Change it", 0),
        assistant([edit, write, failed], 1_000, "toolUse"),
        { ...toolResult(edit, "Edited", 2_000), details: { diff: " 1 a\n-2 b\n+2 c", patch: "", firstChangedLine: 2 } },
        toolResult(write, "Wrote", 3_000),
        { ...toolResult(failed, "No match", 4_000, true), details: {} },
      ],
    });
    const rows = turn!.activity.flatMap((item) => (item.kind === "rows" ? item.rows : []));
    expect(rows[0]).toMatchObject({ changes: { added: 1, removed: 1 }, view: { kind: "diff", path: "src/a.ts" } });
    expect(rows[1]).toMatchObject({ changes: { added: 2, removed: 0 }, view: { kind: "code", code: "one\ntwo\n" } });
    expect(rows[2]).toMatchObject({ status: "error", output: "No match" });
    expect(rows[2]!.view).toBeUndefined();
  });
});
