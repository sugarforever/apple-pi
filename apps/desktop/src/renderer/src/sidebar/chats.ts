import type { SessionInfo } from "@earendil-works/pi-coding-agent";

export interface TitleSources {
  /** What an extension set with `setTitle`, which wins while the chat is open. */
  extensionTitle?: string;
  /** The name Pi stores for the session (`set_session_name`). */
  sessionName?: string;
  firstMessage?: string;
}

const clean = (value: string | undefined) => value?.replace(/\s+/g, " ").trim() || undefined;

/** A chat's title: the extension's, then Pi's session name, then the first message. */
export function chatTitle({ extensionTitle, sessionName, firstMessage }: TitleSources): string {
  return clean(extensionTitle) ?? clean(sessionName) ?? clean(firstMessage) ?? "New chat";
}

export const sessionTitle = (session: SessionInfo): string => chatTitle({ sessionName: session.name, firstMessage: session.firstMessage });

/** Newest first, by the time Pi last wrote the session. */
export const newestFirst = (sessions: readonly SessionInfo[]): SessionInfo[] =>
  [...sessions].sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

export interface ChatRef {
  workspace: string;
  sessionFile: string;
}

/**
 * The chat `step` places before or after `current` in the sidebar's order (the
 * given projects top to bottom, each newest first), wrapping at the ends. With
 * no current chat, the first or last one.
 */
export function adjacentChat(
  projects: readonly { workspace: string; chats?: readonly SessionInfo[] }[],
  current: string | undefined,
  step: 1 | -1,
): ChatRef | undefined {
  const order = projects.flatMap(({ workspace, chats = [] }) => chats.map((session) => ({ workspace, sessionFile: session.path })));
  if (order.length === 0) return undefined;
  const index = order.findIndex((chat) => chat.sessionFile === current);
  if (index < 0) return order[step > 0 ? 0 : order.length - 1];
  return order[(index + step + order.length) % order.length];
}

/** Chats whose title contains every word of the query, ignoring case. */
export function matchesQuery(title: string, query: string): boolean {
  const haystack = title.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
