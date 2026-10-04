import React, { useEffect, useRef, useState } from "react";
import { Copy, CopyPlus, Ellipsis, FileCog, FoldVertical, SquareTerminal } from "lucide-react";
import { MenuItem, useMenu } from "../menu/menu.js";
import type { SessionStats } from "../pi/types.js";

export interface ConversationMenuProps {
  workspace: string;
  sessionFile?: string;
  /** Pi's statistics for the open session; absent when no session is open. */
  loadStats?(): Promise<SessionStats>;
  compact?(): Promise<void>;
  /** Copies the chat into a new one; absent until the chat has a session file. */
  duplicate?(): Promise<void>;
  onError(error: unknown): void;
  /** Starts open with these statistics, for visual fixtures. */
  initialStats?: SessionStats;
}

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** The title bar's "…" menu: workspace shortcuts, session actions, and Pi's session statistics. */
export function ConversationMenu({ workspace, sessionFile, loadStats, compact, duplicate, onError, initialStats }: ConversationMenuProps) {
  const { open, setOpen, focusItem, toggle, rootRef, triggerRef, menuRef, onMenuKey } = useMenu(Boolean(initialStats));
  const [stats, setStats] = useState<SessionStats | undefined>(initialStats);
  const loader = useRef(loadStats);
  useEffect(() => {
    loader.current = loadStats;
  });

  // Fresh numbers each time the menu opens.
  useEffect(() => {
    if (!open) return;
    focusItem();
    let current = true;
    loader
      .current?.()
      .then((loaded) => current && setStats(loaded))
      .catch(() => current && setStats(undefined));
    return () => {
      current = false;
    };
  }, [open, focusItem]);

  const run = (action: () => Promise<unknown> | undefined) => () => {
    setOpen(false);
    void Promise.resolve(action()).catch(onError);
  };

  return (
    <div className="conversation-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button title-bar-button"
        aria-label="Conversation actions"
        title="Conversation actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Ellipsis size={18} />
      </button>
      {open && (
        <div ref={menuRef} className="menu conversation-menu-popup" role="menu" aria-label="Conversation actions" onKeyDown={onMenuKey}>
          <MenuItem icon={<SquareTerminal size={15} />} label="Open terminal here" onSelect={run(() => window.applePi.shell.openTerminal(workspace))} />
          <MenuItem icon={<FileCog size={15} />} label="Open Pi settings.json" onSelect={run(() => window.applePi.shell.openSettingsFile())} />
          <div className="menu-separator" role="separator" />
          <MenuItem icon={<CopyPlus size={15} />} label="Duplicate chat" disabled={!duplicate} onSelect={run(() => duplicate?.())} />
          <MenuItem icon={<FoldVertical size={15} />} label="Compact conversation" disabled={!compact} onSelect={run(() => compact?.())} />
          <MenuItem
            icon={<Copy size={15} />}
            label="Copy session file path"
            disabled={!sessionFile}
            onSelect={run(() => (sessionFile ? navigator.clipboard.writeText(sessionFile) : undefined))}
          />
          {stats && <StatsSection stats={stats} />}
        </div>
      )}
    </div>
  );
}

function StatsSection({ stats }: { stats: SessionStats }) {
  const context = stats.contextUsage;
  const rows: [string, string][] = [
    ["Messages", `${stats.userMessages} sent · ${stats.assistantMessages} replies`],
    ["Tool calls", String(stats.toolCalls)],
    ["Tokens", `${compactNumber.format(stats.tokens.input)} in · ${compactNumber.format(stats.tokens.output)} out`],
  ];
  if (stats.tokens.cacheRead > 0) rows.push(["Cache read", compactNumber.format(stats.tokens.cacheRead)]);
  if (context?.percent != null) rows.push(["Context", `${Math.round(context.percent)}% of ${compactNumber.format(context.contextWindow)}`]);
  if (stats.cost > 0) rows.push(["Cost", `$${stats.cost.toFixed(2)}`]);
  return (
    <>
      <div className="menu-separator" role="separator" />
      <div className="menu-heading">Session</div>
      <dl className="session-stats">
        {rows.map(([label, value]) => (
          <div key={label} className="session-stats-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
