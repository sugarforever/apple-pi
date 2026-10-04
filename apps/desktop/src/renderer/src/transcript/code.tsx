import React, { useMemo, useState } from "react";
import { lineCount } from "./diff.js";
import { type Language, useHighlighter } from "./highlight.js";

/** Long code and diffs in tool rows show this many lines until expanded. */
export const COLLAPSED_LINES = 30;

/** Code in a `<pre>`, highlighted once the highlighter has loaded. With `collapse`, long code shows its start and a "Show all" control. */
export function Code({ code, language, collapse = false, className }: { code: string; language?: Language; collapse?: boolean; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const total = lineCount(code);
  const clipped = collapse && !expanded && total > COLLAPSED_LINES;
  const shown = clipped ? code.split("\n", COLLAPSED_LINES).join("\n") : code;
  const highlighter = useHighlighter(Boolean(language));
  const html = useMemo(() => (highlighter && language ? highlighter.highlight(shown, language.id) : undefined), [highlighter, language, shown]);
  return (
    <>
      <pre className={className}>{html === undefined ? <code>{shown}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}</pre>
      {clipped && <ShowAll lines={total} onClick={() => setExpanded(true)} />}
    </>
  );
}

export function ShowAll({ lines, onClick }: { lines: number; onClick(): void }) {
  return (
    <button type="button" className="show-all" onClick={onClick}>
      Show all {lines} lines
    </button>
  );
}
