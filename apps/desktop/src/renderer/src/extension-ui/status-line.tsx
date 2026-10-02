import React from "react";
import type { ExtensionUIState } from "./reducer.js";

/** Extension status entries, in one muted line under the composer. */
export function StatusLine({ statuses }: { statuses: ExtensionUIState["statuses"] }) {
  if (statuses.length === 0) return null;
  return (
    <ul className="extension-status" aria-label="Extension status">
      {statuses.map((status) => (
        <li key={status.key} className="extension-status-item" title={status.text}>
          {status.text}
        </li>
      ))}
    </ul>
  );
}
