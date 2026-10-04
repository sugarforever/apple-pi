import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Plus, Square } from "lucide-react";
import type { PromptCommand, SlashCommand } from "../pi/types.js";
import type { TranscriptState } from "../transcript/reducer.js";
import { Attachments, type Attachment } from "./attachments.js";
import { CommandPalette } from "./command-palette.js";
import { buildPrompt, filterCommands, readImage, slashQuery } from "./prompt.js";
import { QueuedMessages } from "./queue.js";
import "./composer.css";

export interface ComposerProps {
  running: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Controls that sit between the attach and send buttons, such as the model picker. */
  controls?: ReactNode;
  /** Messages Pi has queued while running. */
  queue?: TranscriptState["queue"];
  /** Pi's slash commands, fetched when the draft starts with "/". */
  loadCommands?(): Promise<SlashCommand[]>;
  onSend(command: PromptCommand): void;
  onStop(): void;
  /** Escape in the input stops a running turn; off while something else owns Escape, such as an extension dialog. */
  escapeStops?: boolean;
  /** Empties Pi's queue and returns the texts it held, which go back into the draft. */
  onClearQueue?(): Promise<string[]>;
  /** Starting content, for restored drafts and visual fixtures. */
  initialDraft?: string;
  initialAttachments?: Attachment[];
  /** Text an extension put in the editor; replaces the draft whenever `id` changes. */
  editorText?: { id: string; text: string };
}

const FOLLOW_UP_KEY = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac") ? "⌥↵" : "Alt+Enter";
let nextAttachment = 0;

export function Composer(props: ComposerProps) {
  const { running, disabled, placeholder = "Ask Pi anything", controls, queue, loadCommands, onSend, onStop, escapeStops, onClearQueue } = props;
  const [draft, setDraft] = useState(props.initialDraft ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>(props.initialAttachments ?? []);
  const [commands, setCommands] = useState<SlashCommand[]>();
  /** The draft the palette was dismissed at; typing brings it back. */
  const [dismissedAt, setDismissedAt] = useState<string>();
  const [active, setActive] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const paletteId = useId();

  const query = slashQuery(draft);
  const wantsPalette = query !== undefined && dismissedAt !== draft && Boolean(loadCommands);
  const matches = wantsPalette && commands ? filterCommands(commands, query) : [];
  const paletteOpen = wantsPalette && commands !== undefined;
  const highlighted = Math.min(active, Math.max(matches.length - 1, 0));

  // Commands can change as extensions load, so fetch them each time the palette opens.
  const loader = useRef(loadCommands);
  useEffect(() => {
    loader.current = loadCommands;
  });
  useEffect(() => {
    if (!wantsPalette) return;
    let current = true;
    loader
      .current?.()
      .then((loaded) => current && setCommands(loaded))
      .catch(() => current && setCommands([]));
    return () => {
      current = false;
    };
  }, [wantsPalette]);

  // An extension's `set_editor_text` replaces the draft, as in Pi's own editor.
  const { editorText } = props;
  const [appliedEditorText, setAppliedEditorText] = useState<string>();
  if (editorText && editorText.id !== appliedEditorText) {
    setAppliedEditorText(editorText.id);
    setDraft(editorText.text);
  }
  useEffect(() => {
    if (editorText) input.current?.focus();
  }, [editorText]);

  const canSend = !disabled && (draft.trim().length > 0 || attachments.length > 0);

  const changeDraft = (value: string) => {
    setDraft(value);
    setActive(0);
  };

  const send = (followUp = false) => {
    if (!canSend) return;
    onSend(
      buildPrompt(
        draft.trim(),
        attachments.map((item) => item.image),
        { running, followUp },
      ),
    );
    changeDraft("");
    setAttachments([]);
  };

  const pick = (command: SlashCommand) => {
    changeDraft(`/${command.name} `);
    input.current?.focus();
  };

  const attach = async (files: Iterable<File>) => {
    const images = [...files].filter((file) => file.type.startsWith("image/"));
    const added = await Promise.all(
      images.map(async (file) => ({ id: `attachment-${++nextAttachment}`, name: file.name || "Pasted image", image: await readImage(file) })),
    );
    if (added.length > 0) setAttachments((current) => [...current, ...added]);
  };

  const clearQueue = async () => {
    const texts = (await onClearQueue?.()) ?? [];
    // Like Pi's own editor, cleared messages come back for editing instead of vanishing.
    if (texts.length > 0) setDraft((current) => [...texts, current].filter(Boolean).join("\n\n"));
    input.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (paletteOpen && matches.length > 0) {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (step !== undefined) {
        event.preventDefault();
        setActive((highlighted + step + matches.length) % matches.length);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        pick(matches[highlighted]!);
        return;
      }
    }
    if (paletteOpen && event.key === "Escape") {
      event.preventDefault();
      setDismissedAt(draft);
      return;
    }
    if (escapeStops && running && event.key === "Escape") {
      event.preventDefault();
      onStop();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(event.altKey);
    }
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        void attach(event.dataTransfer.files);
      }}
    >
      {paletteOpen && <CommandPalette id={paletteId} commands={matches} active={highlighted} onPick={pick} onHover={setActive} />}
      {queue && <QueuedMessages queue={queue} onClear={() => void clearQueue()} />}
      <Attachments items={attachments} onRemove={(id) => setAttachments((current) => current.filter((item) => item.id !== id))} />
      <textarea
        ref={input}
        className="composer-input"
        value={draft}
        placeholder={placeholder}
        aria-label="Message"
        rows={2}
        disabled={disabled}
        role={paletteOpen ? "combobox" : undefined}
        aria-expanded={paletteOpen || undefined}
        aria-controls={paletteOpen ? paletteId : undefined}
        aria-activedescendant={paletteOpen && matches.length > 0 ? `${paletteId}-${highlighted}` : undefined}
        onChange={(event) => changeDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
          if (files.length === 0) return;
          event.preventDefault();
          void attach(files);
        }}
      />
      <div className="composer-bar">
        <button
          type="button"
          className="icon-button composer-attach"
          aria-label="Attach images"
          title="Attach images"
          disabled={disabled}
          onClick={() => filePicker.current?.click()}
        >
          <Plus size={20} />
        </button>
        <input
          ref={filePicker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void attach(event.target.files ?? []);
            event.target.value = "";
          }}
        />
        {running && <span className="composer-hint">↵ steer · {FOLLOW_UP_KEY} follow up</span>}
        <div className="composer-controls">{controls}</div>
        {running && canSend && (
          <button type="submit" className="composer-send composer-queue-send" aria-label="Queue message" title="Queue as steer">
            <ArrowUp size={18} strokeWidth={2.2} />
          </button>
        )}
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
