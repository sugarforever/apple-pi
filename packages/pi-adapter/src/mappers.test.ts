import { describe, expect, it } from "vitest";
import { mapPiEvent, mapPiMessages, mapPiModel, mapPiSessionItem, mapPiSkill, mapPiSkillDiagnostic } from "./mappers.js";

describe("Pi boundary mappers", () => {
  it("maps Pi messages without exposing Pi fields", () => {
    expect(
      mapPiMessages([
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
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "read",
          content: [{ type: "text", text: "# Apple Pi" }],
          details: { piOnly: true },
          isError: false,
          timestamp: 3,
        },
      ]),
    ).toEqual([
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", text: "Inspect" },
          { type: "tool_call", id: "call-1", name: "read", arguments: { path: "README.md" } },
          { type: "text", text: "Done" },
        ],
      },
      { role: "tool", content: [{ type: "tool_result", toolCallId: "call-1", name: "read", output: [{ type: "text", text: "# Apple Pi" }], isError: false }] },
    ]);
  });

  it.each([
    [{ type: "agent_start" }, { type: "lifecycle", phase: "started" }],
    [
      { type: "agent_end", messages: [], willRetry: false },
      { type: "lifecycle", phase: "completed" },
    ],
    [
      { type: "agent_end", messages: [{ role: "assistant", stopReason: "aborted" }], willRetry: false },
      { type: "lifecycle", phase: "cancelled" },
    ],
    [
      { type: "agent_end", messages: [{ role: "assistant", stopReason: "error", errorMessage: "Provider unavailable" }], willRetry: false },
      { type: "lifecycle", phase: "failed", message: "Provider unavailable" },
    ],
    [
      { type: "agent_end", messages: [], willRetry: true },
      { type: "resync_required", reason: "Pi agent scheduled a retry" },
    ],
    [
      { type: "message_update", message: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hi", partial: {} } },
      { type: "text_delta", text: "Hi" },
    ],
    [
      { type: "message_update", message: {}, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Hmm", partial: {} } },
      { type: "thinking_delta", text: "Hmm" },
    ],
    [
      {
        type: "message_update",
        message: {},
        assistantMessageEvent: {
          type: "toolcall_start",
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }] },
        },
      },
      { type: "tool_call", phase: "started", id: "call-1", name: "bash", arguments: {} },
    ],
    [
      {
        type: "message_update",
        message: {},
        assistantMessageEvent: {
          type: "toolcall_delta",
          contentIndex: 0,
          delta: '{"command":"pwd"}',
          partial: { content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } }] },
        },
      },
      { type: "tool_call", phase: "updated", id: "call-1", name: "bash", arguments: { command: "pwd" } },
    ],
    [
      {
        type: "message_update",
        message: {},
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } },
          partial: {},
        },
      },
      { type: "tool_call", phase: "completed", id: "call-1", name: "bash", arguments: { command: "pwd" } },
    ],
    [
      { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "pwd" } },
      { type: "resync_required", reason: "Pi tool execution started: bash" },
    ],
    [
      {
        type: "tool_execution_update",
        toolCallId: "call-1",
        toolName: "bash",
        args: { command: "pwd" },
        partialResult: { content: [{ type: "text", text: "/tm" }] },
      },
      { type: "resync_required", reason: "Pi tool execution updated: bash" },
    ],
    [
      { type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: { content: [{ type: "text", text: "/tmp" }] }, isError: false },
      { type: "tool_result", id: "call-1", name: "bash", output: [{ type: "text", text: "/tmp" }], isError: false },
    ],
    [
      { type: "queue_update", steering: ["Correct course"], followUp: ["Then test"] },
      { type: "resync_required", reason: "Pi queue changed" },
    ],
    [
      { type: "compaction_start", reason: "threshold" },
      { type: "resync_required", reason: "Pi compaction started (threshold)" },
    ],
    [
      { type: "compaction_end", reason: "overflow", result: {}, aborted: false, willRetry: false },
      { type: "resync_required", reason: "Pi compaction completed (overflow)" },
    ],
    [
      { type: "compaction_end", reason: "manual", result: undefined, aborted: true, willRetry: false },
      { type: "resync_required", reason: "Pi compaction aborted (manual)" },
    ],
    [
      { type: "compaction_end", reason: "overflow", result: undefined, aborted: false, willRetry: true, errorMessage: "Context too large" },
      { type: "resync_required", reason: "Pi compaction will retry (overflow): Context too large" },
    ],
    [
      {
        type: "compaction_end",
        reason: "threshold",
        result: undefined,
        aborted: false,
        willRetry: false,
        errorMessage: "Auto-compaction failed: Provider unavailable",
      },
      { type: "resync_required", reason: "Pi compaction failed (threshold): Auto-compaction failed: Provider unavailable" },
    ],
    [
      { type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 500, errorMessage: "Rate limited" },
      { type: "resync_required", reason: "Pi retry 2/3 scheduled in 500ms: Rate limited" },
    ],
    [
      { type: "auto_retry_end", success: true, attempt: 2 },
      { type: "resync_required", reason: "Pi retry 2 succeeded" },
    ],
    [
      { type: "auto_retry_end", success: false, attempt: 3, finalError: "Still unavailable" },
      { type: "resync_required", reason: "Pi retry 3 failed: Still unavailable" },
    ],
    [
      { type: "summarization_retry_scheduled", attempt: 1, maxAttempts: 3, delayMs: 500, errorMessage: "Stream closed" },
      { type: "resync_required", reason: "Pi summarization retry 1/3 scheduled in 500ms: Stream closed" },
    ],
    [
      { type: "summarization_retry_attempt_start", source: "compaction", reason: "threshold" },
      { type: "resync_required", reason: "Pi compaction summarization retry started (threshold)" },
    ],
    [
      { type: "summarization_retry_attempt_start", source: "branchSummary" },
      { type: "resync_required", reason: "Pi branch summary retry started" },
    ],
    [{ type: "summarization_retry_finished" }, { type: "resync_required", reason: "Pi summarization retry finished" }],
    [
      { type: "future_pi_event", internal: true },
      { type: "resync_required", reason: "Unsupported Pi event: future_pi_event" },
    ],
  ])("maps a Pi event into an Apple Pi event", (input, expected) => {
    expect(mapPiEvent(input)).toEqual(expected);
  });

  it("maps model and session summaries", () => {
    expect(mapPiModel({ provider: "openai", id: "gpt-5", name: "GPT-5", piOnly: true })).toEqual({ provider: "openai", modelId: "gpt-5", name: "GPT-5" });
    expect(
      mapPiSessionItem({
        id: "s1",
        path: "/tmp/s1.jsonl",
        name: "First",
        firstMessage: "fallback",
        created: new Date("2026-09-12T10:00:00.000Z"),
        modified: new Date("2026-09-12T10:01:00.000Z"),
        messageCount: 2,
      }),
    ).toEqual({ id: "s1", path: "/tmp/s1.jsonl", name: "First", created: "2026-09-12T10:00:00.000Z", modified: "2026-09-12T10:01:00.000Z", messageCount: 2 });
  });

  it("turns a long first message into a compact fallback session title", () => {
    expect(
      mapPiSessionItem({
        id: "s1",
        path: "/tmp/s1.jsonl",
        firstMessage:
          "  Review the current VerySmallWoods Video Skill.\n\nIt uses or references the Record Terminal Skill, so please find when that is used and improve it.  ",
        created: new Date("2026-09-12T10:00:00.000Z"),
        modified: new Date("2026-09-12T10:01:00.000Z"),
        messageCount: 2,
      }),
    ).toEqual({
      id: "s1",
      path: "/tmp/s1.jsonl",
      name: "Review the current VerySmallWoods Video Skill.…",
      created: "2026-09-12T10:00:00.000Z",
      modified: "2026-09-12T10:01:00.000Z",
      messageCount: 2,
    });
  });

  it("preserves an explicit Pi session name exactly", () => {
    expect(
      mapPiSessionItem({
        id: "s1",
        path: "/tmp/s1.jsonl",
        name: "  Release   plan  ",
        firstMessage: "Fallback title",
        created: new Date("2026-09-12T10:00:00.000Z"),
        modified: new Date("2026-09-12T10:01:00.000Z"),
        messageCount: 2,
      }).name,
    ).toBe("  Release   plan  ");
  });

  it("does not split a composed emoji when compacting a fallback title", () => {
    const prefix = "a".repeat(46);
    expect(
      mapPiSessionItem({
        id: "s1",
        path: "/tmp/s1.jsonl",
        firstMessage: `${prefix}👨‍👩‍👧‍👦 trailing text`,
        created: new Date("2026-09-12T10:00:00.000Z"),
        modified: new Date("2026-09-12T10:01:00.000Z"),
        messageCount: 1,
      }).name,
    ).toBe(`${prefix}👨‍👩‍👧‍👦…`);
  });

  it("keeps the New session fallback when Pi has no usable title source", () => {
    expect(
      mapPiSessionItem({
        id: "s1",
        path: "/tmp/s1.jsonl",
        created: new Date("2026-09-12T10:00:00.000Z"),
        modified: new Date("2026-09-12T10:01:00.000Z"),
        messageCount: 0,
      }).name,
    ).toBe("New session");
  });

  it("uses explicit safe fallbacks for unsupported Pi values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(
      mapPiEvent({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_end",
          toolCall: {
            type: "toolCall",
            id: "call-1",
            name: "bash",
            arguments: { timeout: 1n, score: Number.NaN, cyclic, date: new Date("2026-09-12T10:00:00.000Z"), map: new Map() },
          },
        },
      }),
    ).toEqual({
      type: "tool_call",
      phase: "completed",
      id: "call-1",
      name: "bash",
      arguments: {
        timeout: "1",
        score: "[Unsupported number: NaN]",
        cyclic: { self: "[Circular Pi value]" },
        date: "[Unsupported Pi object: Date]",
        map: "[Unsupported Pi object: Map]",
      },
    });
    expect(
      mapPiEvent({
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "bash",
        result: { content: [{ type: "audio", data: "ignored" }] },
        isError: false,
      }),
    ).toEqual({
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
    expect(mapPiEvent({ type: "message_update", assistantMessageEvent: { type: unprintable } })).toEqual({
      type: "resync_required",
      reason: "Unsupported Pi message update: unknown",
    });
    expect(mapPiEvent({ type: "compaction_start", reason: unprintable })).toEqual({ type: "resync_required", reason: "Pi compaction started (unknown)" });
    expect(mapPiEvent({ type: "auto_retry_start", attempt: unprintable, maxAttempts: unprintable, delayMs: unprintable })).toEqual({
      type: "resync_required",
      reason: "Pi retry unknown/unknown scheduled in unknownms",
    });
    expect(
      mapPiEvent({ type: "tool_execution_end", toolCallId: "call-1", toolName: "read", result: { content: [{ type: unprintable }] }, isError: false }),
    ).toEqual({
      type: "tool_result",
      id: "call-1",
      name: "read",
      output: [{ type: "text", text: "[Unsupported Pi tool output: unknown]" }],
      isError: false,
    });
  });

  it("keeps a tool-call lifecycle monotonic across generation and execution", () => {
    const events = [
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }] },
        },
      },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_delta",
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } }] },
        },
      },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } },
        },
      },
      { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "pwd" } },
    ].map(mapPiEvent);

    expect(events.map((event) => (event.type === "tool_call" ? event.phase : event.type))).toEqual(["started", "updated", "completed", "resync_required"]);
  });

  it("safely resyncs incomplete streamed tool-call identities", () => {
    expect(
      mapPiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: { content: [{ type: "toolCall", id: "", name: "bash", arguments: {} }] } },
      }),
    ).toEqual({
      type: "resync_required",
      reason: "Malformed Pi message update: toolcall_start",
    });
    expect(
      mapPiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, partial: { content: [{ type: "toolCall", id: "call-1", name: "", arguments: {} }] } },
      }),
    ).toEqual({
      type: "resync_required",
      reason: "Malformed Pi message update: toolcall_delta",
    });
  });

  it("safely degrades incomplete tool identities in events and persisted messages", () => {
    expect(mapPiEvent({ type: "tool_execution_end", toolCallId: "", toolName: "bash", result: { content: [] }, isError: false })).toEqual({
      type: "resync_required",
      reason: "Malformed Pi event: tool_execution_end",
    });
    expect(mapPiMessages([{ role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "", arguments: {} }] }])).toEqual([
      { role: "assistant", content: [{ type: "text", text: "[Unsupported Pi content part]" }] },
    ]);
    expect(mapPiMessages([{ role: "toolResult", toolCallId: "", toolName: "bash", content: [], isError: false }])).toEqual([]);
  });

  it("safely degrades tool images with an empty MIME type", () => {
    const fallback = [{ type: "text" as const, text: "[Unsupported Pi tool output: image]" }];
    expect(
      mapPiEvent({
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "image",
        result: { content: [{ type: "image", data: "aW1hZ2U=", mimeType: "" }] },
        isError: false,
      }),
    ).toEqual({
      type: "tool_result",
      id: "call-1",
      name: "image",
      output: fallback,
      isError: false,
    });
    expect(
      mapPiMessages([
        { role: "toolResult", toolCallId: "call-1", toolName: "image", content: [{ type: "image", data: "aW1hZ2U=", mimeType: "" }], isError: false },
      ]),
    ).toEqual([{ role: "tool", content: [{ type: "tool_result", toolCallId: "call-1", name: "image", output: fallback, isError: false }] }]);
  });
});

describe("Pi skill mappers", () => {
  it("maps an auto-discovered user-scope skill as Apple-Pi-managed", () => {
    expect(
      mapPiSkill({
        name: "pdf-forms",
        description: "Fill and flatten PDF forms.",
        filePath: "/home/jane/.pi/agent/skills/pdf-forms/SKILL.md",
        baseDir: "/home/jane/.pi/agent/skills/pdf-forms",
        sourceInfo: { path: "/home/jane/.pi/agent/skills/pdf-forms", source: "auto", scope: "user", origin: "top-level" },
        disableModelInvocation: false,
      }),
    ).toEqual({
      name: "pdf-forms",
      description: "Fill and flatten PDF forms.",
      scope: "user",
      path: "/home/jane/.pi/agent/skills/pdf-forms/SKILL.md",
      disableModelInvocation: false,
      managed: true,
    });
  });

  it("maps an auto-discovered project-scope skill", () => {
    expect(
      mapPiSkill({
        name: "release-notes",
        description: "Draft release notes from recent commits.",
        filePath: "/repo/.pi/skills/release-notes/SKILL.md",
        baseDir: "/repo/.pi/skills/release-notes",
        sourceInfo: { path: "/repo/.pi/skills/release-notes", source: "auto", scope: "project", origin: "top-level" },
        disableModelInvocation: true,
      }),
    ).toEqual({
      name: "release-notes",
      description: "Draft release notes from recent commits.",
      scope: "project",
      path: "/repo/.pi/skills/release-notes/SKILL.md",
      disableModelInvocation: true,
      managed: true,
    });
  });

  it("marks a skill added via settings.json's skills array as not Apple-Pi-managed", () => {
    expect(
      mapPiSkill({
        name: "custom-linter",
        description: "Runs the team's custom linter.",
        filePath: "/opt/shared-skills/custom-linter/SKILL.md",
        baseDir: "/opt/shared-skills/custom-linter",
        sourceInfo: { path: "/opt/shared-skills/custom-linter", source: "local", scope: "project", origin: "top-level" },
        disableModelInvocation: false,
      }),
    ).toMatchObject({ managed: false });
  });

  it("marks a package-provided skill as not Apple-Pi-managed", () => {
    expect(
      mapPiSkill({
        name: "bundled-helper",
        description: "Ships with an installed extension package.",
        filePath: "/repo/node_modules/some-pi-extension/skills/bundled-helper/SKILL.md",
        baseDir: "/repo/node_modules/some-pi-extension/skills/bundled-helper",
        sourceInfo: { path: "some-pi-extension", source: "package:some-pi-extension", scope: "project", origin: "package" },
        disableModelInvocation: false,
      }),
    ).toMatchObject({ managed: false });
  });

  it("maps a warning diagnostic without a collision", () => {
    expect(
      mapPiSkillDiagnostic({
        type: "warning",
        message: "Skill 'legacy-helper' is missing a description and was skipped.",
        path: "/repo/.pi/skills/legacy-helper/SKILL.md",
      }),
    ).toEqual({
      type: "warning",
      message: "Skill 'legacy-helper' is missing a description and was skipped.",
      path: "/repo/.pi/skills/legacy-helper/SKILL.md",
    });
  });

  it("maps a name-collision diagnostic, forcing the collision's resourceType to skill", () => {
    expect(
      mapPiSkillDiagnostic({
        type: "collision",
        message: "Skill 'pdf-forms' is defined in two locations; the project copy wins.",
        collision: {
          resourceType: "skill",
          name: "pdf-forms",
          winnerPath: "/repo/.pi/skills/pdf-forms/SKILL.md",
          loserPath: "/home/jane/.pi/agent/skills/pdf-forms/SKILL.md",
          winnerSource: "project",
          loserSource: "user",
        },
      }),
    ).toEqual({
      type: "collision",
      message: "Skill 'pdf-forms' is defined in two locations; the project copy wins.",
      collision: {
        resourceType: "skill",
        name: "pdf-forms",
        winnerPath: "/repo/.pi/skills/pdf-forms/SKILL.md",
        loserPath: "/home/jane/.pi/agent/skills/pdf-forms/SKILL.md",
        winnerSource: "project",
        loserSource: "user",
      },
    });
  });
});
