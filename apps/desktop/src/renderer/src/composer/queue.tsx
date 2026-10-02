import React from "react";
import type { TranscriptState } from "../transcript/reducer.js";

/** Messages Pi holds until the current turn (steer) or the whole run (follow-up) ends. */
export function QueuedMessages({ queue, onClear }: { queue: TranscriptState["queue"]; onClear(): void }) {
  const items = [...queue.steering.map((text) => ({ kind: "Steer", text })), ...queue.followUp.map((text) => ({ kind: "Follow-up", text }))];
  if (items.length === 0) return null;
  return (
    <div className="composer-queue">
      <ul aria-label="Queued messages">
        {items.map((item, index) => (
          <li key={index} className="composer-queue-item">
            <span className="composer-queue-kind">{item.kind}</span>
            <span className="composer-queue-text">{item.text}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="composer-text-button" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
