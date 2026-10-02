import React, { type ReactNode } from "react";
import { Composer } from "../composer/composer.js";
import { ModelPicker } from "../composer/model-picker.js";
import { TranscriptView } from "../transcript/transcript-view.js";
import { usePiSession, type PiSessionOptions } from "../transcript/use-pi-session.js";
import type { TranscriptState } from "../transcript/reducer.js";

/** A live Pi session: its transcript and the composer that drives it. */
export function Conversation(props: PiSessionOptions & { workspaceName: string }) {
  const session = usePiSession(props);
  const { request, sessionState } = session;

  const loadModels = async () => {
    const [models, levels] = await Promise.all([request({ type: "get_available_models" }), request({ type: "get_available_thinking_levels" })]);
    return { models: models.data.models, levels: levels.data.levels };
  };

  return (
    <ConversationLayout
      state={session.state}
      workspaceName={props.workspaceName}
      composer={
        <Composer
          running={session.running}
          queue={session.state.queue}
          loadCommands={async () => (await request({ type: "get_commands" })).data.commands}
          onSend={(command) => void session.prompt(command)}
          onStop={() => void session.abort()}
          onClearQueue={session.clearQueue}
          controls={
            <ModelPicker
              model={sessionState?.model}
              thinkingLevel={sessionState?.thinkingLevel}
              load={loadModels}
              onSelectModel={(model) => void session.configure({ type: "set_model", provider: model.provider, modelId: model.id })}
              onSelectThinking={(level) => void session.configure({ type: "set_thinking_level", level })}
            />
          }
        />
      }
    />
  );
}

export function ConversationLayout(props: { state: TranscriptState; workspaceName: string; composer: ReactNode }) {
  return (
    <main className="conversation">
      <TranscriptView state={props.state} empty={<h1 className="conversation-empty">What should Pi do in {props.workspaceName}?</h1>} />
      <div className="composer-dock">{props.composer}</div>
    </main>
  );
}
