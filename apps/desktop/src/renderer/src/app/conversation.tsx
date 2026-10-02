import React, { type ReactNode } from "react";
import type { RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { Composer } from "../composer/composer.js";
import { ModelPicker } from "../composer/model-picker.js";
import { DialogCard } from "../extension-ui/dialog-card.js";
import { Notifications } from "../extension-ui/notifications.js";
import type { ExtensionUIState, PendingDialog } from "../extension-ui/reducer.js";
import { StatusLine } from "../extension-ui/status-line.js";
import { useExtensionUI } from "../extension-ui/use-extension-ui.js";
import { Widgets } from "../extension-ui/widgets.js";
import { TranscriptView } from "../transcript/transcript-view.js";
import { usePiSession, type PiSessionOptions } from "../transcript/use-pi-session.js";
import type { TranscriptState } from "../transcript/reducer.js";
import "../extension-ui/extension-ui.css";

/** A live Pi session: its transcript, the composer that drives it, and what its extensions show. */
export function Conversation(props: PiSessionOptions & { workspaceName: string }) {
  const extensionUI = useExtensionUI();
  const session = usePiSession({ ...props, onExtensionEvent: extensionUI.receive, onExited: extensionUI.exited });
  const { request, sessionState } = session;

  const loadModels = async () => {
    const [models, levels] = await Promise.all([request({ type: "get_available_models" }), request({ type: "get_available_thinking_levels" })]);
    return { models: models.data.models, levels: levels.data.levels };
  };

  return (
    <ConversationLayout
      state={session.state}
      workspaceName={props.workspaceName}
      extensionUI={{ state: extensionUI.state, onRespond: extensionUI.respond, onDismissNotice: extensionUI.dismissNotice }}
      composer={
        <Composer
          running={session.running}
          queue={session.state.queue}
          editorText={extensionUI.state.editorText}
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

export interface ConversationExtensionUI {
  state: ExtensionUIState;
  onRespond(dialog: PendingDialog, response: RpcExtensionUIResponse): void;
  onDismissNotice(id: string): void;
}

export function ConversationLayout(props: { state: TranscriptState; workspaceName: string; composer: ReactNode; extensionUI?: ConversationExtensionUI }) {
  const ui = props.extensionUI;
  const dialog = ui?.state.dialogs[0];
  return (
    <main className="conversation">
      <TranscriptView state={props.state} empty={<h1 className="conversation-empty">What should Pi do in {props.workspaceName}?</h1>} />
      <div className="composer-dock">
        {ui && <Widgets widgets={ui.state.widgets} placement="aboveEditor" />}
        {ui && dialog && <DialogCard key={dialog.request.id} dialog={dialog} queued={ui.state.dialogs.length - 1} onRespond={ui.onRespond} />}
        {props.composer}
        {ui && <Widgets widgets={ui.state.widgets} placement="belowEditor" />}
        {ui && <StatusLine statuses={ui.state.statuses} />}
      </div>
      {ui && <Notifications notices={ui.state.notices} onDismiss={ui.onDismissNotice} />}
    </main>
  );
}
