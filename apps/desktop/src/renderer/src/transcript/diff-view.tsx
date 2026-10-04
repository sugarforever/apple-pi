import React, { type CSSProperties, useMemo, useState } from "react";
import { COLLAPSED_LINES, ShowAll } from "./code.js";
import type { DiffLine } from "./diff.js";
import { type Language, useHighlighter } from "./highlight.js";

const signs = { added: "+", removed: "−", context: "" };

/** An edit's diff: line numbers, added and removed lines on tinted rows, and a gap between hunks. */
export function DiffView({ lines, language }: { lines: DiffLine[]; language?: Language }) {
  const [expanded, setExpanded] = useState(false);
  const shown = useMemo(() => (expanded ? lines : lines.slice(0, COLLAPSED_LINES)), [expanded, lines]);
  const highlighter = useHighlighter(Boolean(language));
  const html = useMemo(
    () => (highlighter && language ? shown.map((line) => (line.kind === "gap" ? "" : highlighter.highlight(line.text, language.id))) : undefined),
    [highlighter, language, shown],
  );
  const widest = Math.max(...lines.map((line) => (line.kind === "gap" ? 0 : line.line)));
  return (
    <>
      <div className="diff">
        <div className="diff-lines" style={{ "--diff-digits": `${String(widest).length}ch` } as CSSProperties}>
          {shown.map((line, index) =>
            line.kind === "gap" ? (
              <div key={index} className="diff-line" data-kind="gap" aria-label="Unchanged lines">
                <span className="diff-number">⋯</span>
              </div>
            ) : (
              <div key={index} className="diff-line" data-kind={line.kind}>
                <span className="diff-number">{line.line}</span>
                <span className="diff-sign">{signs[line.kind]}</span>
                {html ? <code dangerouslySetInnerHTML={{ __html: html[index]! }} /> : <code>{line.text}</code>}
              </div>
            ),
          )}
        </div>
      </div>
      {shown.length < lines.length && <ShowAll lines={lines.length} onClick={() => setExpanded(true)} />}
    </>
  );
}
