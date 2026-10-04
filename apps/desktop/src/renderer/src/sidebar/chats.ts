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

/** Chats whose title contains every word of the query, ignoring case. */
export function matchesQuery(title: string, query: string): boolean {
  const haystack = title.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
