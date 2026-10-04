import React, { useEffect, useImperativeHandle, type ReactNode, type Ref } from "react";
import type { RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { Composer } from "../composer/composer.js";
import { ModelPicker } from "../composer/model-picker.js";
import { DialogCard } from "../extension-ui/dialog-card.js";
import { Notifications } from "../extension-ui/notifications.js";
import type { ExtensionUIState, PendingDialog } from "../extension-ui/reducer.js";
import { StatusLine } from "../extension-ui/status-line.js";
import { useExtensionUI } from "../extension-ui/use-extension-ui.js";
import { Widgets } from "../extension-ui/widgets.js";
import { chatTitle } from "../sidebar/chats.js";
import { userEntryFromEnd } from "../transcript/fork.js";
import { TranscriptView } from "../transcript/transcript-view.js";
import { usePiSession, type PiSession, type PiSessionOptions } from "../transcript/use-pi-session.js";
import type { TranscriptState } from "../transcript/reducer.js";
import type { UserMessage } from "../pi/types.js";
import "../extension-ui/extension-ui.css";

/** What the window's title bar can ask of the open conversation. */
export interface ConversationHandle {
  request: PiSession["request"];
  /** Copies the chat into a new session (Pi's `clone`) and opens the copy. */
  duplicate(): Promise<void>;
}

export interface ConversationProps extends PiSessionOptions {
  workspaceName: string;
  /** True for a chat started in this window, which opens on the new-chat prompt. */
  isNew?: boolean;
  /** Reports the title to show for this chat whenever it changes. */
  onTitle?(title: string): void;
  /**
   * Called once Pi has moved this chat's process to a fork or copy, with the
   * new session file and, for a fork, the text of the message forked from.
   */
  onBranch?(sessionFile: string, draft?: string): void;
  /** Starting composer text, such as the message a fork was taken from. */
  initialDraft?: string;
  /** Reports a failed action that has no place in the transcript, such as a refused fork. */
  onError?(error: unknown): void;
  ref?: Ref<ConversationHandle>;
}

const firstUserText = (state: TranscriptState): string | undefined => {
  const first = state.messages.find((message): message is UserMessage => message.role === "user");
  if (!first) return state.pendingPrompt?.text;
  return typeof first.content === "string" ? first.content : first.content.find((block) => block.type === "text")?.text;
};

/** A live Pi session: its transcript, the composer that drives it, and what its extensions show. */
export function Conversation({ workspaceName, isNew, onTitle, onBranch, onError, initialDraft, ref, ...options }: ConversationProps) {
  const extensionUI = useExtensionUI();
  const session = usePiSession({ ...options, onExtensionEvent: extensionUI.receive, onExited: extensionUI.exited });
  const { request, sessionState, running } = session;

  // Fork and clone move this process to a new session file, which then opens as its own chat.
  const branched = async (cancelled: boolean, draft?: string) => {
    if (cancelled) return;
    const { data } = await request({ type: "get_state" });
    if (data.sessionFile) onBranch?.(data.sessionFile, draft);
  };
  const duplicate = async () => {
    if (running) throw new Error("Wait for Pi to finish before duplicating this chat.");
    await branched((await request({ type: "clone" })).data.cancelled);
  };
  const fork = async (message: UserMessage) => {
    const users = session.state.messages.filter((item) => item.role === "user");
    const { data } = await request({ type: "get_entries" });
    const entryId = userEntryFromEnd(data.entries, data.leafId, users.length - users.indexOf(message));
    if (!entryId) throw new Error("Pi could not find this message in the session.");
    const forked = await request({ type: "fork", entryId });
    await branched(forked.data.cancelled, forked.data.text);
  };

  useImperativeHandle(ref, () => ({ request, duplicate }));

  const title = chatTitle({ extensionTitle: extensionUI.state.title, sessionName: sessionState?.sessionName, firstMessage: firstUserText(session.state) });
  useEffect(() => onTitle?.(title), [onTitle, title]);

  const loadModels = async () => {
    const [models, levels] = await Promise.all([request({ type: "get_available_models" }), request({ type: "get_available_thinking_levels" })]);
    return { models: models.data.models, levels: levels.data.levels };
  };

  return (
    <ConversationLayout
      state={session.state}
      workspaceName={workspaceName}
      isNew={isNew}
      extensionUI={{ state: extensionUI.state, onRespond: extensionUI.respond, onDismissNotice: extensionUI.dismissNotice }}
      onFork={running ? undefined : (message) => void fork(message).catch(onError)}
      composer={
        <Composer
          running={session.running}
          initialDraft={initialDraft}
          queue={session.state.queue}
          editorText={extensionUI.state.editorText}
          loadCommands={async () => (await request({ type: "get_commands" })).data.commands}
          onSend={(command) => void session.prompt(command)}
          onStop={() => void session.abort()}
          escapeStops={extensionUI.state.dialogs.length === 0}
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

export interface ConversationLayoutProps {
  state: TranscriptState;
  workspaceName: string;
  isNew?: boolean;
  composer: ReactNode;
  extensionUI?: ConversationExtensionUI;
  onFork?(message: UserMessage): void;
}

const isBlank = (state: TranscriptState) => state.messages.length === 0 && !state.streaming && !state.pendingPrompt && !state.error && !state.status;

export function ConversationLayout(props: ConversationLayoutProps) {
  const ui = props.extensionUI;
  const dialog = ui?.state.dialogs[0];
  // A new chat starts on a centred prompt; the transcript takes over once something is sent.
  const starting = props.isNew && isBlank(props.state);
  return (
    <main className="conversation" data-starting={starting || undefined}>
      {starting ? (
        <h1 className="conversation-start">What should we build in {props.workspaceName}?</h1>
      ) : (
        <TranscriptView state={props.state} onFork={props.onFork} />
      )}
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
