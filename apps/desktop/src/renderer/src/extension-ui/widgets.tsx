import React from "react";
import type { Widget } from "./reducer.js";

/** Extension widgets for one side of the composer: plain text lines, as in Pi's TUI. */
export function Widgets({ widgets, placement }: { widgets: readonly Widget[]; placement: Widget["placement"] }) {
  const shown = widgets.filter((widget) => widget.placement === placement && widget.lines.length > 0);
  if (shown.length === 0) return null;
  return (
    <div className={`extension-widgets extension-widgets-${placement}`}>
      {shown.map((widget) => (
        <pre key={widget.key} className="extension-widget" aria-label={widget.key}>
          {widget.lines.join("\n")}
        </pre>
      ))}
    </div>
  );
}
