import { expect, it } from "vitest";
import type { SessionEntry } from "../pi/types.js";
import { userEntryFromEnd } from "./fork.js";

const message = (id: string, parentId: string | null, role: "user" | "assistant") =>
  ({ type: "message", id, parentId, timestamp: "", message: { role, content: [], timestamp: 0 } }) as unknown as SessionEntry;

it("counts user messages back from the leaf along the active branch only", () => {
  // u1 → a1 → u2 → a2 is active; u3 branches off a1 and is not.
  const entries = [
    message("u1", null, "user"),
    message("a1", "u1", "assistant"),
    message("u2", "a1", "user"),
    message("a2", "u2", "assistant"),
    message("u3", "a1", "user"),
  ];
  expect(userEntryFromEnd(entries, "a2", 1)).toBe("u2");
  expect(userEntryFromEnd(entries, "a2", 2)).toBe("u1");
  expect(userEntryFromEnd(entries, "a2", 3)).toBeUndefined();
  expect(userEntryFromEnd(entries, null, 1)).toBeUndefined();
});
