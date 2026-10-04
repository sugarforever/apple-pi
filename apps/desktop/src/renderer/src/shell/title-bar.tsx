import React, { type ReactNode } from "react";
import { PanelLeft } from "lucide-react";

export interface TitleBarProps {
  sidebarOpen: boolean;
  onToggleSidebar(): void;
  /** Sits before the title: the project folder, or the view's own icon. */
  icon?: ReactNode;
  title?: string;
  /** Hover text for the title, such as the project path. */
  detail?: string;
  /** Buttons at the right end, such as the conversation menu. */
  actions?: ReactNode;
}

/**
 * The draggable row across the top of the window. Its leading part spans the
 * rail and sidebar so the title lines up with the main view below it.
 */
export function TitleBar({ sidebarOpen, onToggleSidebar, icon, title, detail, actions }: TitleBarProps) {
  return (
    <header className="title-bar">
      <div className="title-bar-lead">
        <button
          type="button"
          className="icon-button title-bar-button"
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-pressed={sidebarOpen}
          onClick={onToggleSidebar}
        >
          <PanelLeft size={17} />
        </button>
      </div>
      <div className="title-bar-main">
        {icon && <span className="title-bar-icon">{icon}</span>}
        {title && (
          <h1 className="title-bar-title" title={detail ?? title}>
            {title}
          </h1>
        )}
        {actions && <div className="title-bar-actions">{actions}</div>}
      </div>
    </header>
  );
}
