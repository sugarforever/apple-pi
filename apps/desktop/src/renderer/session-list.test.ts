import { describe, expect, it } from "vitest";
import { materializeDraftSession, reconcileSessionList, shouldOpenSession, type UiSessionItem } from "./session-list.js";

const persisted = (id: string): UiSessionItem => ({
  id,
  path: `/sessions/${id}.jsonl`,
  name: id,
  created: "2026-09-24T00:00:00.000Z",
  modified: "2026-09-24T00:00:00.000Z",
  messageCount: 1,
  persisted: true,
});

const draft = (id: string): UiSessionItem => ({
  ...persisted(id),
  path: "",
  messageCount: 0,
  persisted: false,
});

describe("session list reconciliation", () => {
  it("does not reopen the already-active session row", () => {
    expect(shouldOpenSession("session-1", "session-1")).toBe(false);
    expect(shouldOpenSession("session-1", "session-2")).toBe(true);
  });

  it("rebinds a new draft to the real session while keeping it visible", () => {
    expect(
      materializeDraftSession([draft("draft-1"), draft("draft-2")], "draft-1", {
        opened: true,
        sessionId: "session-1",
        messages: [],
        running: false,
      }),
    ).toEqual([{ ...draft("draft-1"), id: "session-1" }, draft("draft-2")]);
  });

  it("preserves unrelated local drafts during an ordinary refresh", () => {
    expect(reconcileSessionList([draft("draft-1")], [persisted("session-1")])).toEqual([persisted("session-1"), draft("draft-1")]);
  });

  it("replaces a materialized draft only after its persisted session is listed", () => {
    const materialized = { ...draft("draft-1"), id: "session-1" };
    expect(reconcileSessionList([materialized], [])).toEqual([materialized]);
    expect(reconcileSessionList([materialized], [persisted("session-1")])).toEqual([persisted("session-1")]);
  });
});
