import type { ApplePiMessage } from "@apple-pi/protocol";
import { describe, expect, it } from "vitest";
import { toTimelineItems } from "./tool-activity.js";

describe("tool activity timeline", () => {
  it("groups a tool call with its result instead of exposing either as Pi prose", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", text: "Inspect the workspace" },
          { type: "tool_call", id: "call-1", name: "bash", arguments: { command: "ls -la" } },
        ],
      },
      {
        role: "tool",
        content: [{ type: "tool_result", toolCallId: "call-1", name: "bash", output: [{ type: "text", text: "total 0" }], isError: false }],
      },
    ] satisfies ApplePiMessage[];
    const items = toTimelineItems(messages);

    expect(items).toEqual([
      {
        kind: "tool",
        id: "call-1",
        name: "bash",
        summary: "ls -la",
        argumentsText: '{\n  "command": "ls -la"\n}',
        outputParts: [{ kind: "text", text: "total 0" }],
        status: "success",
      },
    ]);
  });

  it("marks failed and unfinished calls with their distinct statuses", () => {
    const messages = [
      { role: "assistant", content: [{ type: "tool_call", id: "failed", name: "bash", arguments: { command: "git log" } }] },
      { role: "tool", content: [{ type: "tool_result", toolCallId: "failed", name: "bash", output: [{ type: "text", text: "exit 128" }], isError: true }] },
      { role: "assistant", content: [{ type: "tool_call", id: "running", name: "read", arguments: { path: "/tmp/file" } }] },
    ] satisfies ApplePiMessage[];
    const items = toTimelineItems(messages);

    expect(items).toMatchObject([
      { kind: "tool", id: "failed", summary: "git log", outputParts: [{ kind: "text", text: "exit 128" }], status: "error" },
      { kind: "tool", id: "running", summary: "/tmp/file", outputParts: [], status: "running" },
    ]);
  });

  it("keeps user and assistant text while omitting thinking content", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "What changed?" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", text: "Do not display" },
          { type: "text", text: "Two files changed." },
        ],
      },
    ] satisfies ApplePiMessage[];
    const items = toTimelineItems(messages);

    expect(items).toEqual([
      { kind: "message", role: "user", text: "What changed?" },
      { kind: "message", role: "assistant", text: "Two files changed." },
    ]);
  });

  it("preserves image output and distinguishes an empty completed result", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "tool_call", id: "image", name: "screenshot", arguments: {} },
          { type: "tool_call", id: "empty", name: "write", arguments: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool_result",
            toolCallId: "image",
            name: "screenshot",
            output: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
            isError: false,
          },
        ],
      },
      { role: "tool", content: [{ type: "tool_result", toolCallId: "empty", name: "write", output: [], isError: false }] },
    ] satisfies ApplePiMessage[];
    const items = toTimelineItems(messages);

    expect(items).toMatchObject([
      { kind: "tool", id: "image", status: "success", outputParts: [{ kind: "image", data: "aW1hZ2U=", mimeType: "image/png" }] },
      { kind: "tool", id: "empty", status: "success", outputParts: [] },
    ]);
  });
});
