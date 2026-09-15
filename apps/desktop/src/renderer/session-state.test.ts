import type { ApplePiSessionEvent, SessionSnapshot } from "@apple-pi/protocol";
import { describe, expect, it } from "vitest";
import { initialSessionState, reduceSession, type SessionState } from "./session-state.js";

const openedSnapshot = {
  opened: true,
  sessionId: "s1",
  messages: [{ role: "user", content: [{ type: "text", text: "Run the checks" }] }],
  running: false,
} satisfies SessionSnapshot;

const openedState = (snapshot: SessionSnapshot = openedSnapshot): SessionState => reduceSession(initialSessionState, { type: "operation_snapshot", snapshot });

describe("session state", () => {
  it("applies ordered text and thinking deltas without requesting a snapshot", () => {
    const withText = reduceSession(openedState(), { type: "event", sequence: 1, payload: { type: "text_delta", text: "Checking" } });
    const withMoreText = reduceSession(withText, { type: "event", sequence: 2, payload: { type: "text_delta", text: " files" } });
    const withThinking = reduceSession(withMoreText, { type: "event", sequence: 3, payload: { type: "thinking_delta", text: "Need tests" } });

    expect(withThinking).toMatchObject({
      lastSequence: 3,
      sync: { status: "synced", generation: 0 },
      messages: [
        { role: "user", content: [{ type: "text", text: "Run the checks" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Checking files" },
            { type: "thinking", text: "Need tests" },
          ],
        },
      ],
    });
  });

  it("applies every tool and lifecycle discriminator directly", () => {
    const events = [
      { type: "tool_call", phase: "started", id: "call-1", name: "bash", arguments: { command: "pnpm test" } },
      { type: "tool_call", phase: "updated", id: "call-1", name: "bash", arguments: { command: "pnpm test --run" } },
      { type: "tool_call", phase: "completed", id: "call-1", name: "bash", arguments: { command: "pnpm test --run" } },
      { type: "tool_result", id: "call-1", name: "bash", output: [{ type: "text", text: "12 passed" }], isError: false },
      { type: "lifecycle", phase: "started" },
      { type: "lifecycle", phase: "completed" },
      { type: "lifecycle", phase: "started" },
      { type: "lifecycle", phase: "cancelled" },
      { type: "lifecycle", phase: "started" },
      { type: "lifecycle", phase: "failed", message: "Provider unavailable" },
    ] satisfies ApplePiSessionEvent[];

    const final = events.reduce((state, payload, index) => reduceSession(state, { type: "event", sequence: index + 1, payload }), openedState());

    expect(final).toMatchObject({
      lastSequence: events.length,
      sync: { status: "synced", generation: 0 },
      running: false,
      error: "Provider unavailable",
      messages: [
        { role: "user" },
        { role: "assistant", content: [{ type: "tool_call", id: "call-1", name: "bash", arguments: { command: "pnpm test --run" } }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call-1", name: "bash", output: [{ type: "text", text: "12 passed" }], isError: false }] },
      ],
    });
  });

  it("ignores a duplicate event instead of applying its delta twice", () => {
    const first = reduceSession(openedState(), { type: "event", sequence: 1, payload: { type: "text_delta", text: "once" } });
    const duplicate = reduceSession(first, { type: "event", sequence: 1, payload: { type: "text_delta", text: "once" } });

    expect(duplicate).toEqual(first);
  });

  it("projects an optimistic Apple Pi user message until the authoritative snapshot arrives", () => {
    const optimistic = reduceSession(openedState(), { type: "user_message", text: "What changed?" });

    expect(optimistic.messages.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: "What changed?" }] });
    expect(reduceSession(optimistic, { type: "operation_snapshot", snapshot: openedSnapshot }).messages).toEqual(openedSnapshot.messages);
  });

  it("withholds sequence-gap events and requires a post-race snapshot before recovery", () => {
    const first = reduceSession(openedState(), { type: "event", sequence: 1, payload: { type: "text_delta", text: "safe" } });
    const gap = reduceSession(first, { type: "event", sequence: 3, payload: { type: "text_delta", text: "unsafe" } });
    const whileWaiting = reduceSession(gap, { type: "event", sequence: 4, payload: { type: "text_delta", text: "also unsafe" } });

    expect(whileWaiting).toMatchObject({ lastSequence: 4, sync: { status: "resyncing", generation: 1, dirty: true } });
    expect(whileWaiting.messages).toEqual(first.messages);

    if (gap.sync.status !== "resyncing") throw new Error("Expected resyncing state");
    const staleSnapshot = reduceSession(whileWaiting, { type: "resync_snapshot", snapshot: openedSnapshot, generation: gap.sync.generation });
    expect(staleSnapshot).toMatchObject({ lastSequence: 4, sync: { status: "resyncing", generation: gap.sync.generation + 1, dirty: false } });

    if (staleSnapshot.sync.status !== "resyncing") throw new Error("Expected follow-up resync");
    const recovered = reduceSession(staleSnapshot, { type: "resync_snapshot", snapshot: openedSnapshot, generation: staleSnapshot.sync.generation });
    expect(recovered).toMatchObject({
      lastSequence: 4,
      sync: { status: "synced", generation: staleSnapshot.sync.generation },
      running: false,
      messages: openedSnapshot.messages,
    });
  });

  it("requests resync only for the explicit resync discriminator", () => {
    const state = reduceSession(openedState(), { type: "event", sequence: 1, payload: { type: "resync_required", reason: "Pi queue changed" } });

    expect(state).toMatchObject({ lastSequence: 1, sync: { status: "resyncing", generation: 1, dirty: false } });
    expect(state.messages).toEqual(openedSnapshot.messages);
  });

  it("exposes a failed resync and retries only after an explicit action", () => {
    const gap = reduceSession(openedState(), { type: "event", sequence: 2, payload: { type: "text_delta", text: "unsafe" } });
    if (gap.sync.status !== "resyncing") throw new Error("Expected resyncing state");
    const failed = reduceSession(gap, { type: "resync_failed", generation: gap.sync.generation, error: "Host busy" });
    expect(failed).toMatchObject({ sync: { status: "failed", generation: gap.sync.generation, error: "Host busy" }, error: "Host busy" });

    const eventWhileFailed = reduceSession(failed, { type: "event", sequence: 3, payload: { type: "lifecycle", phase: "completed" } });
    expect(eventWhileFailed).toMatchObject({ lastSequence: 3, sync: { status: "failed", generation: gap.sync.generation, error: "Host busy" } });

    const retry = reduceSession(eventWhileFailed, { type: "retry_resync" });
    expect(retry).toMatchObject({ sync: { status: "resyncing", generation: gap.sync.generation + 1, dirty: false }, error: undefined });
  });
});
