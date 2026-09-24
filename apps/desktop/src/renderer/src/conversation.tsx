import React from "react";
import { AlertCircle, Check, ChevronDown, CircleDashed, FolderInput, Send, Sparkles, Terminal } from "lucide-react";
import type { SessionState } from "../session-state.js";
import type { TimelineItem, ToolItem } from "../tool-activity.js";
import type { ModelItem } from "../global.js";
import { ModelSelect, modelKey } from "./model-select.js";

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export const markdownToHtml = (value: string): { __html: string } => {
  const codeBlocks: string[] = [];
  const fenced = value.replace(/```([\s\S]*?)```/g, (_match, block) => {
    const i = codeBlocks.length;
    codeBlocks.push(String(block));
    return `\u0000CODEBLOCK_${i}\u0000`;
  });

  const escaped = escapeHtml(fenced)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  const withCode = codeBlocks.reduce(
    (html, block, i) => html.replace(`\u0000CODEBLOCK_${i}\u0000`, `<pre><code>${escapeHtml(block).trimEnd()}</code></pre>`),
    escaped,
  );

  return {
    __html: withCode
      .split("\n\n")
      .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br/>")}</p>`)
      .join(""),
  };
};

export function ConversationView(props: {
  state: SessionState;
  timelineItems: TimelineItem[];
  activeModelUnavailable: boolean;
  draft: string;
  draftSessionId: string;
  models: Map<string, ModelItem[]>;
  onDraftChange(value: string): void;
  onOpenWorkspace(): void;
  onModelChange(value: string): void;
  onSend(): void;
}) {
  return (
    <>
      <section className="timeline" id="conversation" aria-label="Conversation" role="log" aria-live="polite" tabIndex={-1}>
        {!props.state.opened && <ConversationEmptyState onOpenWorkspace={props.onOpenWorkspace} />}
        {props.timelineItems.map((item, index) =>
          item.kind === "tool" ? (
            <ToolActivity key={`tool-${item.id}-${index}`} item={item} />
          ) : (
            <article key={`message-${index}`} className={`message ${item.role}`}>
              <header className="message-author">
                <span>{item.role === "user" ? "You" : "Pi"}</span>
              </header>
              <div className="message-content" dangerouslySetInnerHTML={markdownToHtml(item.text)} />
            </article>
          ),
        )}
        {props.state.error && (
          <div className="timeline-error" role="alert">
            {props.state.error}
          </div>
        )}
      </section>
      {props.activeModelUnavailable && (
        <p className="model-unavailable-notice" role="status">
          This session’s model is no longer available. Choose another model to continue.
        </p>
      )}
      <Composer
        state={props.state}
        draft={props.draft}
        draftSessionId={props.draftSessionId}
        models={props.models}
        onDraftChange={props.onDraftChange}
        onModelChange={props.onModelChange}
        onSend={props.onSend}
      />
    </>
  );
}

function ConversationEmptyState({ onOpenWorkspace }: { onOpenWorkspace(): void }) {
  return (
    <div className="empty">
      <Sparkles size={18} />
      <div>
        <h1>Start a focused coding session</h1>
        <p>Open a workspace to work with Pi. Your projects and transcripts stay on this machine.</p>
      </div>
      <button onClick={onOpenWorkspace}>
        <FolderInput size={15} /> Open Workspace
      </button>
    </div>
  );
}

function Composer(props: {
  state: SessionState;
  draft: string;
  draftSessionId: string;
  models: Map<string, ModelItem[]>;
  onDraftChange(value: string): void;
  onModelChange(value: string): void;
  onSend(): void;
}) {
  return (
    <footer className="composer">
      <div className="input-toolbar">
        <textarea
          name="message"
          autoComplete="off"
          disabled={!props.state.opened || props.state.running}
          value={props.draft}
          onChange={(event) => props.onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              props.onSend();
            }
          }}
          aria-label="Message Pi"
          placeholder={props.state.opened ? "Ask Pi to build, debug, or explain…" : "Open a workspace to start"}
        />
        <div className="composer-bottom">
          <div className="model-select-wrap">
            {props.state.opened && !props.draftSessionId ? <Sparkles size={13} /> : <CircleDashed size={13} />}
            <ModelSelect
              ariaLabel="Session model"
              models={props.models}
              value={props.state.opened && props.state.model ? modelKey(props.state.model) : ""}
              onChange={props.onModelChange}
              emptyLabel={props.state.opened ? "Default model" : "Select model"}
              disabled={!props.state.opened}
            />
            <ChevronDown size={12} className="select-chevron" />
          </div>
          <span className="send-hint">↵ send · ⇧↵ new line</span>
        </div>
      </div>
      <button
        aria-label="Send message"
        disabled={!props.state.opened || !props.draft.trim() || props.state.running}
        onClick={props.onSend}
        title="Send message"
      >
        <Send size={15} />
      </button>
    </footer>
  );
}

export function ToolActivity({ item }: { item: ToolItem }) {
  const statusLabel = item.status === "running" ? "Running" : item.status === "error" ? "Failed" : "Completed";
  const statusIcon = item.status === "running" ? <CircleDashed size={11} /> : item.status === "error" ? <AlertCircle size={11} /> : <Check size={11} />;
  const toolLabel = item.name === "bash" ? "Terminal" : item.name.replaceAll("_", " ");

  return (
    <details className={`tool-activity status-${item.status}`}>
      <summary>
        <span className="tool-icon">
          <Terminal size={13} />
        </span>
        <span className="tool-heading">
          <strong>{toolLabel}</strong>
          <code title={item.summary}>{item.summary || "Tool call"}</code>
        </span>
        <span className="tool-status">
          {statusIcon}
          {statusLabel}
        </span>
        <ChevronDown className="tool-chevron" size={12} />
      </summary>
      <div className="tool-details">
        {item.argumentsText && (
          <section>
            <span>Input</span>
            <pre>
              <code>{item.argumentsText}</code>
            </pre>
          </section>
        )}
        {item.status === "running" ? (
          <p>Waiting for the tool to finish…</p>
        ) : (
          <section>
            <span>Output</span>
            {item.outputParts.length === 0 ? (
              <p className="tool-empty-output">Tool returned no output.</p>
            ) : (
              <div className="tool-output">
                {item.outputParts.map((part, index) =>
                  part.kind === "text" ? (
                    <pre key={`text-${index}`}>
                      <code>{part.text}</code>
                    </pre>
                  ) : (
                    <img
                      key={`image-${index}`}
                      src={`data:${part.mimeType};base64,${part.data}`}
                      alt={`${toolLabel} output`}
                      width="960"
                      height="540"
                      loading="lazy"
                    />
                  ),
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </details>
  );
}
