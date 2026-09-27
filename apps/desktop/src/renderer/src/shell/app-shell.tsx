import React, { type ReactNode } from "react";
import { CircleDashed } from "lucide-react";
import "./shell.css";

export interface AppShellProps {
  sidebar: ReactNode;
  header: ReactNode;
  busyLabel: string;
  notice: string;
  error: string;
  onRetry?: () => void;
  children: ReactNode;
}

export function AppShell({ sidebar, header, busyLabel, notice, error, onRetry, children }: AppShellProps) {
  return (
    <div className="shell" aria-busy={Boolean(busyLabel)}>
      <a className="skip-link" href="#conversation">
        Skip to conversation
      </a>
      {sidebar}
      <main>
        {header}
        {children}
      </main>
      <div className="app-feedback" aria-live="polite" aria-atomic="true">
        {busyLabel && (
          <div className="app-status">
            <CircleDashed size={14} />
            {busyLabel}
          </div>
        )}
        {!busyLabel && notice && <div className="app-status success">{notice}</div>}
        {error && (
          <div className="app-error" role="alert">
            {error}
            {onRetry && <button onClick={onRetry}>Retry</button>}
          </div>
        )}
      </div>
    </div>
  );
}
