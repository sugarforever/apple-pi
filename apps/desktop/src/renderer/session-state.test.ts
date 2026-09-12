import { describe, expect, it } from "vitest";
import { initialSessionState, reduceSession } from "./session-state.js";

describe("session state", () => {
  it("marks a sequence gap and recovers from a snapshot", () => {
    const first = reduceSession(initialSessionState, { type: "event", sequence: 2, payload: { type: "text_delta", text: "hi" } });
    expect(first.needsRefresh).toBe(true);
    const recovered = reduceSession(first, { type: "snapshot", snapshot: { opened: true, sessionId: "s1", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], running: false } });
    expect(recovered).toMatchObject({ needsRefresh: false, running: false, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
  });
});
