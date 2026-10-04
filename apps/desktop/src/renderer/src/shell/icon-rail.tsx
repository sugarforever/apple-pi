import React from "react";
import { House, Settings } from "lucide-react";

export type ShellView = "chats" | "settings";

/** The slim column of views at the window's left edge. */
export function IconRail({ view, onSelect }: { view: ShellView; onSelect(view: ShellView): void }) {
  return (
    <nav className="icon-rail" aria-label="Views">
      <RailButton label="Chats" active={view === "chats"} onClick={() => onSelect("chats")}>
        <House size={19} />
      </RailButton>
      <div className="icon-rail-spacer" />
      <RailButton label="Settings" active={view === "settings"} onClick={() => onSelect("settings")}>
        <Settings size={19} />
      </RailButton>
    </nav>
  );
}

function RailButton({ label, active, onClick, children }: { label: string; active: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="icon-button icon-rail-button"
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
