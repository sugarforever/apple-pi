import React, { useEffect, useRef } from "react";
import { CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import type { Notice } from "./reducer.js";

const LIFETIME_MS = { info: 4_000, warning: 6_000, error: 8_000 } as const;
const ICONS = { info: Info, warning: TriangleAlert, error: CircleAlert } as const;

/** Extension notifications and errors, stacked under the title bar and dismissed on their own. */
export function Notifications({ notices, onDismiss }: { notices: readonly Notice[]; onDismiss(id: string): void }) {
  if (notices.length === 0) return null;
  return (
    <div className="extension-notices">
      {notices.map((notice) => (
        <Toast key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({ notice, onDismiss }: { notice: Notice; onDismiss(id: string): void }) {
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss.current(notice.id), LIFETIME_MS[notice.level]);
    return () => window.clearTimeout(timer);
  }, [notice.id, notice.level]);

  const Icon = ICONS[notice.level];
  return (
    <div className={`extension-notice extension-notice-${notice.level}`} role={notice.level === "error" ? "alert" : "status"}>
      <Icon className="extension-notice-icon" size={15} aria-hidden />
      <span className="extension-notice-text">{notice.message}</span>
      <button type="button" className="extension-notice-close" aria-label="Dismiss" onClick={() => onDismiss(notice.id)}>
        <X size={14} />
      </button>
    </div>
  );
}
