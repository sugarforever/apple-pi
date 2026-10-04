import React from "react";
import { Composer } from "../composer/composer.js";
import { TranscriptView } from "../transcript/transcript-view.js";
import { usePiSession, type PiSessionOptions } from "../transcript/use-pi-session.js";
import type { TranscriptState } from "../transcript/reducer.js";

/** A live Pi session: its transcript and the composer that drives it. */
export function Conversation(props: PiSessionOptions & { workspaceName: string }) {
  const session = usePiSession(props);
  return (
    <ConversationLayout
      state={session.state}
      running={session.running}
      workspaceName={props.workspaceName}
      onSend={(message) => void session.prompt(message)}
      onStop={() => void session.abort()}
    />
  );
}

export function ConversationLayout(props: { state: TranscriptState; running: boolean; workspaceName: string; onSend(message: string): void; onStop(): void }) {
  return (
    <main className="conversation">
      <TranscriptView state={props.state} empty={<h1 className="conversation-empty">What should Pi do in {props.workspaceName}?</h1>} />
      <div className="composer-dock">
        <Composer running={props.running} onSend={props.onSend} onStop={props.onStop} />
      </div>
    </main>
  );
}
