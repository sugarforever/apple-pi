import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import type { UserMessage } from "../pi/types.js";
import type { TranscriptState } from "./reducer.js";
import { MessageBlock } from "./message-block.js";
import { buildTranscript } from "./turns.js";
import { TurnView } from "./turn-view.js";
import "./transcript.css";

/** Distance from the bottom, in pixels, that still counts as following the conversation. */
const FOLLOW_THRESHOLD = 48;

export interface TranscriptViewProps {
  state: TranscriptState;
  empty?: ReactNode;
  footer?: ReactNode;
  /** Offered on each sent message; see `TurnView`. */
  onFork?(message: UserMessage): void;
}

export function TranscriptView({ state, empty, footer, onFork }: TranscriptViewProps) {
  const entries = useMemo(() => buildTranscript(state), [state]);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  // Keep the newest content in view while the user is at the bottom; leave them be once they scroll up.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [entries]);

  const measure = () => {
    const element = scroller.current;
    if (!element) return;
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_THRESHOLD;
    following.current = bottom;
    setAtBottom(bottom);
  };

  // Expanding a turn or a tool row grows the content without scrolling; re-measure then too.
  useEffect(() => {
    const content = scroller.current?.firstElementChild;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      const element = scroller.current;
      if (element) setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_THRESHOLD);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const scrollToBottom = () => {
    following.current = true;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="transcript-frame">
      <div className="transcript-scroller" ref={scroller} onScroll={measure}>
        <div className="transcript" role="log" aria-label="Conversation">
          {entries.length === 0 && empty}
          {entries.map((entry) =>
            entry.kind === "turn" ? (
              <TurnView key={entry.turn.key} turn={entry.turn} onFork={onFork} />
            ) : (
              <MessageBlock key={entry.key} message={entry.message} />
            ),
          )}
          {state.status && <p className="transcript-status">{state.status}</p>}
          {state.error && (
            <p className="transcript-error" role="alert">
              {state.error}
            </p>
          )}
          {footer}
        </div>
      </div>
      {!atBottom && (
        <button type="button" className="scroll-to-bottom" onClick={scrollToBottom} aria-label="Scroll to bottom">
          <ArrowDown size={18} />
        </button>
      )}
    </div>
  );
}
