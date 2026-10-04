import type { SessionEntry } from "../pi/types.js";

/**
 * The id of the user message `fromEnd` places from the end of the active branch
 * (1 is the latest), walking up from `leafId`. The transcript shows that branch,
 * and compaction only trims its start, so counting from the end lines a shown
 * message up with its entry.
 */
export function userEntryFromEnd(entries: readonly SessionEntry[], leafId: string | null, fromEnd: number): string | undefined {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let seen = 0;
  for (let entry = leafId ? byId.get(leafId) : undefined; entry; entry = entry.parentId ? byId.get(entry.parentId) : undefined) {
    if (entry.type === "message" && entry.message.role === "user" && ++seen === fromEnd) return entry.id;
  }
  return undefined;
}
