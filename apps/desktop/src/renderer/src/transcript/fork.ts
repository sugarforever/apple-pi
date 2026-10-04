import type { SessionEntry, UserMessage } from "../pi/types.js";

/**
 * The id of the entry holding `message` on the active branch, walking up from
 * `leafId`. The transcript's messages are the entries' own messages, so the
 * timestamp Pi stamped on the user message identifies it even when compaction
 * or an extension leaves other messages out of view.
 */
export function userEntryId(entries: readonly SessionEntry[], leafId: string | null, message: UserMessage): string | undefined {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (let entry = leafId ? byId.get(leafId) : undefined; entry; entry = entry.parentId ? byId.get(entry.parentId) : undefined) {
    if (entry.type === "message" && entry.message.role === "user" && entry.message.timestamp === message.timestamp) return entry.id;
  }
  return undefined;
}
