import { useCallback, useEffect, useState } from "react";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { Workspace } from "../../../shared/pi-api.js";
import { newestFirst } from "./chats.js";

export interface Workspaces {
  /** Absent until the first list arrives. */
  workspaces?: Workspace[];
  /** Pi's sessions per workspace path, newest first; absent until loaded. */
  sessions: Readonly<Record<string, SessionInfo[]>>;
  /** Workspace paths whose chats the sidebar shows. */
  expanded: ReadonlySet<string>;
  /** Re-reads one workspace's session files. */
  refresh(workspace: string): void;
  /** Loads every workspace's sessions, for search. */
  refreshAll(): void;
  setExpanded(workspace: string, expanded: boolean): void;
  /** Asks for a folder; resolves with the added workspace, or undefined when cancelled. */
  add(): Promise<Workspace | undefined>;
  /** Forgets the workspace; main also stops its Pi processes. */
  remove(workspace: string): Promise<void>;
}

/** The projects Apple Pi remembers and the chats Pi saved in each. */
export function useWorkspaces(report: (error: unknown) => void): Workspaces {
  const [workspaces, setWorkspaces] = useState<Workspace[]>();
  const [sessions, setSessions] = useState<Record<string, SessionInfo[]>>({});
  const [expanded, setExpandedPaths] = useState<ReadonlySet<string>>(new Set());

  const refresh = useCallback(
    (workspace: string) => {
      window.applePi.sessions
        .list(workspace)
        .then((items) => setSessions((current) => ({ ...current, [workspace]: newestFirst(items) })))
        .catch(report);
    },
    [report],
  );

  useEffect(() => {
    window.applePi.workspaces
      .list()
      .then((items) => {
        setWorkspaces(items);
        // Start with the first project open, as a new window would.
        if (items[0]) {
          setExpandedPaths(new Set([items[0].path]));
          refresh(items[0].path);
        }
      })
      .catch(report);
  }, [refresh, report]);

  const refreshAll = useCallback(() => workspaces?.forEach((workspace) => refresh(workspace.path)), [refresh, workspaces]);

  const setExpanded = useCallback(
    (workspace: string, open: boolean) => {
      setExpandedPaths((current) => {
        const next = new Set(current);
        if (open) next.add(workspace);
        else next.delete(workspace);
        return next;
      });
      if (open) refresh(workspace);
    },
    [refresh],
  );

  const add = useCallback(async () => {
    const added = await window.applePi.workspaces.pick();
    if (!added) return undefined;
    setWorkspaces(await window.applePi.workspaces.list());
    setExpanded(added.path, true);
    return added;
  }, [setExpanded]);

  const remove = useCallback(async (workspace: string) => {
    await window.applePi.workspaces.remove(workspace);
    setWorkspaces((current) => current?.filter((item) => item.path !== workspace));
    setExpandedPaths((current) => new Set([...current].filter((path) => path !== workspace)));
  }, []);

  return { workspaces, sessions, expanded, refresh, refreshAll, setExpanded, add, remove };
}
