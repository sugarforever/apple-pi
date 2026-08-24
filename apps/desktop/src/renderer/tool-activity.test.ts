import { describe, expect, it } from "vitest";
import { toTimelineItems } from "./tool-activity.js";

describe("tool activity timeline", () => {
  it("groups a tool call with its result instead of exposing either as Pi prose", () => {
    const items = toTimelineItems([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Inspect the workspace" },
          { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls -la" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "bash",
        content: [{ type: "text", text: "total 0" }],
        isError: false,
      },
    ]);

    expect(items).toEqual([
      {
        kind: "tool",
        id: "call-1",
        name: "bash",
        summary: "ls -la",
        argumentsText: "{\n  \"command\": \"ls -la\"\n}",
        outputParts: [{ kind: "text", text: "total 0" }],
        status: "success",
      },
    ]);
  });

  it("marks failed and unfinished calls with their distinct statuses", () => {
    const items = toTimelineItems([
      { role: "assistant", content: [{ type: "toolCall", id: "failed", name: "bash", arguments: { command: "git log" } }] },
      { role: "toolResult", toolCallId: "failed", toolName: "bash", content: [{ type: "text", text: "exit 128" }], isError: true },
      { role: "assistant", content: [{ type: "toolCall", id: "running", name: "read", arguments: { path: "/tmp/file" } }] },
    ]);

    expect(items).toMatchObject([
      { kind: "tool", id: "failed", summary: "git log", outputParts: [{ kind: "text", text: "exit 128" }], status: "error" },
      { kind: "tool", id: "running", summary: "/tmp/file", outputParts: [], status: "running" },
    ]);
  });

  it("keeps user and assistant text while omitting thinking content", () => {
    const items = toTimelineItems([
      { role: "user", content: [{ type: "text", text: "What changed?" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "Do not display" }, { type: "text", text: "Two files changed." }] },
    ]);

    expect(items).toEqual([
      { kind: "message", role: "user", text: "What changed?" },
      { kind: "message", role: "assistant", text: "Two files changed." },
    ]);
  });

  it("preserves image output and distinguishes an empty completed result", () => {
    const items = toTimelineItems([
      { role: "assistant", content: [{ type: "toolCall", id: "image", name: "screenshot", arguments: {} }, { type: "toolCall", id: "empty", name: "write", arguments: {} }] },
      { role: "toolResult", toolCallId: "image", toolName: "screenshot", content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }], isError: false },
      { role: "toolResult", toolCallId: "empty", toolName: "write", content: [], isError: false },
    ]);

    expect(items).toMatchObject([
      { kind: "tool", id: "image", status: "success", outputParts: [{ kind: "image", data: "aW1hZ2U=", mimeType: "image/png" }] },
      { kind: "tool", id: "empty", status: "success", outputParts: [] },
    ]);
  });
});
