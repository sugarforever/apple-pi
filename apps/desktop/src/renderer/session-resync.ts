import type { SessionSnapshot } from "@apple-pi/protocol";
import type { SessionAction } from "./session-state.js";

type SessionDispatch = (action: SessionAction) => void;

export async function runSessionResync(getSnapshot: () => Promise<SessionSnapshot>, generation: number, dispatch: SessionDispatch): Promise<void> {
  try {
    const snapshot = await getSnapshot();
    dispatch({ type: "resync_snapshot", snapshot, generation });
  } catch (error) {
    dispatch({
      type: "resync_failed",
      generation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
