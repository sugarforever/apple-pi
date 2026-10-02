import React, { useState, type ReactNode } from "react";
import { ArrowUp, Plus, Square } from "lucide-react";
import "./composer.css";

export interface ComposerProps {
  running: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Controls that sit between the attach and send buttons, such as the model picker. */
  controls?: ReactNode;
  onSend(message: string): void;
  onStop(): void;
}

export function Composer({ running, disabled, placeholder = "Ask Pi anything", controls, onSend, onStop }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const canSend = !disabled && !running && draft.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    onSend(draft.trim());
    setDraft("");
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        className="composer-input"
        value={draft}
        placeholder={placeholder}
        aria-label="Message"
        rows={2}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="composer-bar">
        <button type="button" className="icon-button composer-attach" aria-label="Add attachment" title="Attachments are coming soon" disabled>
          <Plus size={20} />
        </button>
        <div className="composer-controls">{controls}</div>
        {running ? (
          <button type="button" className="composer-send" aria-label="Stop" onClick={onStop}>
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button type="submit" className="composer-send" aria-label="Send" disabled={!canSend}>
            <ArrowUp size={18} strokeWidth={2.2} />
          </button>
        )}
      </div>
    </form>
  );
}
