import { describe, expect, it } from "vitest";
import {
  decodeApplePiMessage,
  decodeApplePiContentPart,
  decodeApplePiSessionEvent,
  decodeHostCapabilities,
  decodeModelItem,
  decodeSessionItem,
  decodeSessionSnapshot,
} from "./domain.js";

describe("Apple Pi domain decoders", () => {
  it("decodes a closed session snapshot", () => {
    const snapshot = {
      opened: true,
      sessionId: "session-1",
      sessionFile: "/tmp/session.jsonl",
      messages: [
        { role: "user", content: [{ type: "text", text: "Inspect the project" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "I will inspect it." },
            { type: "tool_call", id: "call-1", name: "read", arguments: { path: "README.md" } },
            { type: "text", text: "The project is ready." },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool_result", toolCallId: "call-1", name: "read", output: [{ type: "text", text: "# Apple Pi" }], isError: false }],
        },
      ],
      running: false,
      model: { provider: "openai", modelId: "gpt-5", name: "GPT-5" },
    };

    expect(decodeSessionSnapshot(snapshot)).toEqual(snapshot);
  });

  it("decodes session, model, and capability fixtures", () => {
    const session = { id: "session-1", path: "/tmp/session.jsonl", name: "First", created: "2026-09-12T10:00:00.000Z", modified: "2026-09-12T10:01:00.000Z", messageCount: 3 };
    const model = { provider: "openai", modelId: "gpt-5", name: "GPT-5" };
    const capabilities = { sessionEvents: true, modelSelection: true, providerManagement: true, cancellableProviderOperations: true };

    expect(decodeSessionItem(session)).toEqual(session);
    expect(decodeModelItem(model)).toEqual(model);
    expect(decodeHostCapabilities(capabilities)).toEqual(capabilities);
  });

  it.each([
    { type: "text_delta", text: "Hello" },
    { type: "thinking_delta", text: "Reasoning" },
    { type: "tool_call", phase: "started", id: "call-1", name: "bash", arguments: { command: "pwd" } },
    { type: "tool_result", id: "call-1", name: "bash", output: [{ type: "text", text: "/tmp" }], isError: false },
    { type: "lifecycle", phase: "started" },
    { type: "resync_required", reason: "unsupported Pi event" },
  ])("decodes the $type event fixture", (event) => {
    expect(decodeApplePiSessionEvent(event)).toEqual(event);
  });

  it("rejects extra fields and Pi-specific fields", () => {
    expect(() => decodeSessionItem({ id: "s", path: "/s", name: "S", created: "now", modified: "now", messageCount: 0, branch: "main" })).toThrow("Invalid session item");
    expect(() => decodeApplePiMessage({ role: "assistant", content: [{ type: "text", text: "ok", piMetadata: true }] })).toThrow("Invalid Apple Pi message");
  });

  it("rejects missing discriminators and invalid values", () => {
    expect(() => decodeApplePiSessionEvent({ messageId: "m1", text: "Hello" })).toThrow("Invalid Apple Pi session event");
    expect(() => decodeApplePiSessionEvent({ type: "lifecycle", phase: "paused" })).toThrow("Invalid Apple Pi session event");
    expect(() => decodeSessionItem({ id: "s", path: "/s", name: "S", created: "now", modified: "now", messageCount: -1 })).toThrow("Invalid session item");
    expect(() => decodeSessionItem({ id: "s", path: "/s", name: "S", created: "yesterday", modified: "2026-09-12T10:01:00.000Z", messageCount: 0 })).toThrow("Invalid session item");
    expect(() => decodeSessionItem({ id: "s", path: "/s", name: "S", created: "2026-04-31T10:00:00.000Z", modified: "2026-09-12T10:01:00.000Z", messageCount: 0 })).toThrow("Invalid session item");
  });

  it("rejects non-serializable values", () => {
    expect(() => decodeApplePiSessionEvent({ type: "tool_call", phase: "started", id: "call-1", name: "bash", arguments: { timeout: 1n } })).toThrow("Invalid Apple Pi session event");
    expect(() => decodeApplePiContentPart({ type: "tool_call", id: "call-1", name: "bash", arguments: { value: new Map() } })).toThrow("Invalid Apple Pi content part");
    expect(() => decodeApplePiContentPart({ type: "tool_call", id: "call-1", name: "bash", arguments: { value: new Date() } })).toThrow("Invalid Apple Pi content part");

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => decodeApplePiContentPart({ type: "tool_call", id: "call-1", name: "bash", arguments: cyclic })).toThrow("Invalid Apple Pi content part");

    const arrayWithMetadata = ["value"] as string[] & { piMetadata?: boolean };
    arrayWithMetadata.piMetadata = true;
    expect(() => decodeApplePiContentPart({ type: "tool_call", id: "call-1", name: "bash", arguments: { value: arrayWithMetadata } })).toThrow("Invalid Apple Pi content part");
  });
});
