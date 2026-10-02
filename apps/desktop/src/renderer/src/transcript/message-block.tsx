import React from "react";
import type { AgentMessage } from "../pi/types.js";
import { ActivityRowView } from "./activity-rows.js";
import { Markdown } from "./markdown.js";

/** Messages other than user, assistant, and tool results: Pi's own roles, extension messages, and anything newer. */
export function MessageBlock({ message }: { message: AgentMessage }) {
  switch (message.role) {
    case "bashExecution":
      return (
        <ActivityRowView
          row={{
            key: "bash",
            verb: "ran",
            label: `Ran ${message.command.split("\n")[0]}`,
            status: message.exitCode === 0 || message.exitCode === undefined ? "done" : "error",
            input: message.command,
            output: message.output,
          }}
        />
      );
    case "compactionSummary":
      return <SummaryBlock title="Context compacted" text={message.summary} />;
    case "branchSummary":
      return <SummaryBlock title="Summary of the branch this conversation came back from" text={message.summary} />;
    case "custom": {
      if (!message.display) return null;
      const text = typeof message.content === "string" ? message.content : message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
      return (
        <div className="note-block">
          <div className="note-title">{message.customType}</div>
          <Markdown text={text} />
        </div>
      );
    }
    default:
      return <UnknownBlock label={`Unsupported message: ${String((message as { role?: unknown }).role)}`} value={message} />;
  }
}

function SummaryBlock({ title, text }: { title: string; text: string }) {
  return (
    <details className="note-block">
      <summary className="note-title">{title}</summary>
      <Markdown text={text} />
    </details>
  );
}

/** A muted, inspectable stand-in for anything this client cannot render yet. */
export function UnknownBlock({ label, value }: { label: string; value: unknown }) {
  let json: string;
  try {
    json = JSON.stringify(value, null, 2);
  } catch {
    json = String(value);
  }
  return (
    <details className="note-block unknown-block">
      <summary className="note-title">{label}</summary>
      <pre>{json}</pre>
    </details>
  );
}
