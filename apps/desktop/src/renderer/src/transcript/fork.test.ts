import { expect, it } from "vitest";
import type { SessionEntry, UserMessage } from "../pi/types.js";
import { userEntryId } from "./fork.js";

const message = (id: string, parentId: string | null, role: "user" | "assistant", timestamp: number) =>
  ({ type: "message", id, parentId, timestamp: "", message: { role, content: [], timestamp } }) as unknown as SessionEntry;
const shown = (timestamp: number): UserMessage => ({ role: "user", content: "", timestamp });

it("finds a user message by its timestamp on the active branch only", () => {
  // u1 → a1 → u2 → a2 is active; u3 branches off a1 with u2's timestamp and is not.
  const entries = [
    message("u1", null, "user", 1),
    message("a1", "u1", "assistant", 2),
    message("u3", "a1", "user", 3),
    message("u2", "a1", "user", 3),
    message("a2", "u2", "assistant", 4),
  ];
  expect(userEntryId(entries, "a2", shown(3))).toBe("u2");
  expect(userEntryId(entries, "a2", shown(1))).toBe("u1");
  expect(userEntryId(entries, "a2", shown(2))).toBeUndefined();
  expect(userEntryId(entries, null, shown(1))).toBeUndefined();
});
