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

export interface NestedChat {
  session: SessionInfo;
  /** 0 for a chat listed on its own, 1 for a fork or copy of it, and so on. */
  depth: number;
}

/**
 * Chats in sidebar order: each fork or copy right under the chat Pi recorded as
 * its parent, when that chat is listed too. A family sits where its most
 * recently written chat would, so a new fork brings its parent along.
 */
export function nestChats(sessions: readonly SessionInfo[]): NestedChat[] {
  const listed = new Set(sessions.map((session) => session.path));
  const children = new Map<string, SessionInfo[]>();
  const roots: SessionInfo[] = [];
  for (const session of sessions) {
    const parent = session.parentSessionPath;
    if (parent && parent !== session.path && listed.has(parent)) children.set(parent, [...(children.get(parent) ?? []), session]);
    else roots.push(session);
  }
  const latest = new Map<string, number>();
  const latestOf = (session: SessionInfo): number => {
    let value = latest.get(session.path);
    if (value === undefined) {
      value = Math.max(new Date(session.modified).getTime(), ...(children.get(session.path) ?? []).map(latestOf));
      latest.set(session.path, value);
    }
    return value;
  };
  const byLatest = (items: readonly SessionInfo[]) => [...items].sort((a, b) => latestOf(b) - latestOf(a));

  const result: NestedChat[] = [];
  const place = (session: SessionInfo, depth: number) => {
    result.push({ session, depth });
    for (const child of byLatest(children.get(session.path) ?? [])) place(child, depth + 1);
  };
  for (const root of byLatest(roots)) place(root, 0);
  // Parent links that loop leave chats no root reaches; list them on their own.
  if (result.length < sessions.length) {
    const placed = new Set(result.map((item) => item.session.path));
    for (const session of sessions) if (!placed.has(session.path)) result.push({ session, depth: 0 });
  }
  return result;
}

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
