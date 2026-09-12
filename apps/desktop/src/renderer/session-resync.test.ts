import type { SessionSnapshot } from "@apple-pi/protocol";
import { describe, expect, it, vi } from "vitest";
import { runSessionResync } from "./session-resync.js";

const snapshot = { opened: false, messages: [], running: false } satisfies SessionSnapshot;

describe("session resync coordinator", () => {
  it("dispatches a generation-bound snapshot only after the request resolves", async () => {
    let resolveSnapshot!: (value: SessionSnapshot) => void;
    const getSnapshot = () => new Promise<SessionSnapshot>((resolve) => { resolveSnapshot = resolve; });
    const dispatch = vi.fn();

    const pending = runSessionResync(getSnapshot, 3, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    resolveSnapshot(snapshot);
    await pending;

    expect(dispatch).toHaveBeenCalledWith({ type: "resync_snapshot", snapshot, generation: 3 });
  });

  it("turns a rejected request into a retryable generation-bound failure", async () => {
    const dispatch = vi.fn();

    await runSessionResync(() => Promise.reject(new Error("Host busy")), 4, dispatch);

    expect(dispatch).toHaveBeenCalledWith({ type: "resync_failed", generation: 4, error: "Host busy" });
  });
});
