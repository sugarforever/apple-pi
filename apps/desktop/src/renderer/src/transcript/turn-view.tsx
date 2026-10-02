import React, { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { UserMessage } from "../pi/types.js";
import { RowGroup } from "./activity-rows.js";
import { Markdown } from "./markdown.js";
import { MessageBlock, UnknownBlock } from "./message-block.js";
import { formatDuration, type ActivityItem, type Turn } from "./turns.js";

export function TurnView({ turn }: { turn: Turn }) {
  // Live turns start open and finished ones closed; a click overrides that until the turn changes state.
  const [override, setOverride] = useState<{ running: boolean; open: boolean }>();
  const expanded = override?.running === turn.running ? override.open : turn.running;
  const hasActivity = turn.activity.length > 0;

  return (
    <section className="turn">
      <UserBubble message={turn.user} />
      {(hasActivity || turn.running || turn.durationMs !== undefined) && (
        <button
          type="button"
          className="worked-for"
          aria-expanded={hasActivity ? expanded : undefined}
          disabled={!hasActivity}
          onClick={() => setOverride({ running: turn.running, open: !expanded })}
        >
          <WorkedForLabel turn={turn} />
          {hasActivity && <ChevronRight className="worked-for-chevron" size={16} aria-hidden />}
        </button>
      )}
      {expanded && hasActivity && (
        <div className="activity">
          {turn.activity.map((item) => (
            <ActivityItemView key={item.key} item={item} />
          ))}
        </div>
      )}
      {turn.answer && <Markdown text={turn.answer} />}
      {turn.notice && (
        <p className="turn-notice" data-tone={turn.notice.tone}>
          {turn.notice.text}
        </p>
      )}
    </section>
  );
}

function WorkedForLabel({ turn }: { turn: Turn }) {
  const now = useNow(turn.running);
  if (turn.running) return <span className="worked-for-live">Working for {formatDuration(now - (turn.startedAt ?? now))}</span>;
  return <span>{turn.durationMs !== undefined && turn.durationMs >= 1000 ? `Worked for ${formatDuration(turn.durationMs)}` : "Worked"}</span>;
}

/** The current time, ticking every second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function ActivityItemView({ item }: { item: ActivityItem }) {
  switch (item.kind) {
    case "text":
      return <Markdown text={item.text} />;
    case "rows":
      return <RowGroup rows={item.rows} summary={item.summary} />;
    case "message":
      return <MessageBlock message={item.message} />;
    case "unknown":
      return <UnknownBlock label={`Unsupported content: ${String((item.value as { type?: unknown } | null)?.type)}`} value={item.value} />;
  }
}

export function UserBubble({ message }: { message: UserMessage }) {
  const parts = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
  return (
    <div className="user-message">
      <div className="user-bubble">
        {parts.map((part, index) =>
          part.type === "text" ? (
            <p key={index}>{part.text}</p>
          ) : part.type === "image" ? (
            <img key={index} src={`data:${part.mimeType};base64,${part.data}`} alt="" />
          ) : (
            <UnknownBlock key={index} label="Unsupported content" value={part} />
          ),
        )}
      </div>
    </div>
  );
}
