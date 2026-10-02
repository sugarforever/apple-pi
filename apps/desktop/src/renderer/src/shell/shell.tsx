import React, { type ReactNode } from "react";
import "./shell.css";

const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

export interface ShellProps {
  titleBar: ReactNode;
  rail: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
}

/** The window: title bar across the top, the icon rail, then the sidebar and main view on one card. */
export function Shell({ titleBar, rail, sidebar, children }: ShellProps) {
  return (
    <div className="shell" data-platform={isMac ? "mac" : undefined} data-sidebar={sidebar ? "open" : "closed"}>
      {titleBar}
      {rail}
      <div className="shell-body">
        {sidebar}
        {children}
      </div>
    </div>
  );
}
