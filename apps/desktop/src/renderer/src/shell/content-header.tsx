import React from "react";
import { Square, X } from "lucide-react";
import { IconButton } from "../ui-primitives.js";

export type ContentHeaderTitle =
  | { kind: "conversation"; workspaceName: string; workspacePath: string; sessionName: string }
  | { kind: "settings"; label?: string }
  | { kind: "workspace-skills"; label?: string };

export interface ContentHeaderProps {
  title: ContentHeaderTitle;
  running: boolean;
  onClose(): void;
  onCancel(): void;
}

export function ContentHeader({ title, running, onClose, onCancel }: ContentHeaderProps) {
  const closeLabel = title.kind === "settings" ? "Close settings" : title.kind === "workspace-skills" ? "Close workspace skills" : undefined;

  return (
    <header>
      <div className="header-title">
        {title.kind === "conversation" ? (
          <>
            <span className="header-context" title={title.workspacePath}>
              {title.workspaceName}
            </span>
            <span className="header-separator">/</span>
            <strong>{title.sessionName}</strong>
          </>
        ) : (
          <strong>{title.label ?? (title.kind === "settings" ? "Settings" : "Workspace Skills")}</strong>
        )}
      </div>
      <div className="header-actions">
        {closeLabel && (
          <IconButton aria-label={closeLabel} onClick={onClose}>
            <X size={17} />
          </IconButton>
        )}
        {running && (
          <button className="cancel" onClick={onCancel}>
            <Square size={11} fill="currentColor" /> Stop
          </button>
        )}
      </div>
    </header>
  );
}
