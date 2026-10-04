import React, { useState } from "react";
import { BookOpen, Brain, ChevronRight, FilePen, FolderTree, Search, SquareTerminal, Wrench, type LucideIcon } from "lucide-react";
import type { ActivityVerb } from "./activity-labels.js";
import { Code } from "./code.js";
import { DiffView } from "./diff-view.js";
import { languageForPath } from "./highlight.js";
import type { ActivityRow, ToolView } from "./turns.js";

const icons: Record<ActivityVerb, LucideIcon> = {
  ran: SquareTerminal,
  read: BookOpen,
  edited: FilePen,
  wrote: FilePen,
  searched: Search,
  listed: FolderTree,
  used: Wrench,
  thought: Brain,
};

/** Consecutive activity rows: one row as itself, several behind a summary row. */
export function RowGroup({ rows, summary }: { rows: ActivityRow[]; summary: string }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 1) return <ActivityRowView row={rows[0]!} />;
  const running = rows.some((row) => row.status === "running");
  const Icon = icons[rows[0]!.verb];
  return (
    <div className="activity-group">
      <button type="button" className="activity-row" data-status={running ? "running" : undefined} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon className="activity-icon" size={16} aria-hidden />
        <span className="activity-label">{summary}</span>
        <ChevronRight className="activity-chevron" size={14} aria-hidden />
      </button>
      {open && (
        <div className="activity-group-rows">
          {rows.map((row) => (
            <ActivityRowView key={row.key} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ActivityRowView({ row }: { row: ActivityRow }) {
  const [open, setOpen] = useState(false);
  const Icon = icons[row.verb];
  const hasDetail = Boolean(row.view || row.input || row.output);
  return (
    <div className="activity-item">
      <button
        type="button"
        className="activity-row"
        data-status={row.status}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
        onClick={() => setOpen(!open)}
        title={row.label}
      >
        <Icon className="activity-icon" size={16} aria-hidden />
        <span className="activity-label">{row.label}</span>
        {row.changes && (
          <span className="activity-changes">
            {row.changes.added > 0 && <span className="change-added">+{row.changes.added}</span>}
            {row.changes.removed > 0 && <span className="change-removed">−{row.changes.removed}</span>}
          </span>
        )}
        {row.status === "error" && <span className="activity-badge">failed</span>}
      </button>
      {open && hasDetail && (
        <div className="activity-detail">
          {row.view ? (
            <FileView view={row.view} />
          ) : (
            <>
              {row.input && <pre className="activity-input">{row.verb === "ran" ? `$ ${row.input}` : row.input}</pre>}
              {row.output && <pre className="activity-output">{row.output}</pre>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FileView({ view }: { view: ToolView }) {
  const language = languageForPath(view.path);
  return view.kind === "diff" ? (
    <DiffView lines={view.lines} language={language} />
  ) : (
    <Code className="activity-code" code={view.code} language={language} collapse />
  );
}
