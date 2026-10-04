import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import type { UserMessage } from "../pi/types.js";
import type { TranscriptState } from "./reducer.js";
import { ScrollRoot } from "./markdown.js";
import { MessageBlock } from "./message-block.js";
import { transcriptBuilder } from "./turns.js";
import { TurnView } from "./turn-view.js";
import "./transcript.css";

/** Distance from the bottom, in pixels, that still counts as following the conversation. */
const FOLLOW_THRESHOLD = 48;
/** The newest turns render their answers right away, so the view opens at an exact bottom; older ones parse as they come into view. */
const EAGER_TURNS = 4;

export interface TranscriptViewProps {
  state: TranscriptState;
  empty?: ReactNode;
  footer?: ReactNode;
  /** Offered on each sent message; see `TurnView`. */
  onFork?(message: UserMessage): void;
}

export function TranscriptView({ state, empty, footer, onFork }: TranscriptViewProps) {
  // Turns that did not change keep their identity, so memoised turn views skip them while a reply streams.
  const [build] = useState(transcriptBuilder);
  const entries = useMemo(() => build(state), [build, state]);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const attachScroller = useCallback((element: HTMLDivElement | null) => {
    scroller.current = element;
    setScrollRoot(element);
  }, []);
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

  const scrollToBottom = (event: React.MouseEvent<HTMLButtonElement>) => {
    following.current = true;
    // The button goes away at the bottom; keyboard focus moves on to the message box instead of being dropped.
    if (document.activeElement === event.currentTarget) document.querySelector<HTMLElement>(".composer-input")?.focus({ preventScroll: true });
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  };

  return (
    <div className="transcript-frame">
      <div className="transcript-scroller" ref={attachScroller} onScroll={measure}>
        <div className="transcript" role="log" aria-label="Conversation">
          {entries.length === 0 && empty}
          <ScrollRoot value={scrollRoot}>
            {entries.map((entry, index) =>
              entry.kind === "turn" ? (
                <TurnView key={entry.turn.key} turn={entry.turn} onFork={onFork} deferred={index < entries.length - EAGER_TURNS} />
              ) : (
                <MessageBlock key={entry.key} message={entry.message} />
              ),
            )}
          </ScrollRoot>
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
        <button type="button" className="scroll-to-bottom" onClick={scrollToBottom} aria-label="Scroll to bottom" title="Scroll to bottom">
          <ArrowDown size={18} />
        </button>
      )}
    </div>
  );
}
