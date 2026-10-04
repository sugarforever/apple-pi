import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { cancelResponse, confirmResponse, stripAnsi, valueResponse, type PendingDialog } from "./reducer.js";

export interface DialogCardProps {
  dialog: PendingDialog;
  /** Dialogs waiting behind this one. */
  queued: number;
  onRespond(dialog: PendingDialog, response: RpcExtensionUIResponse): void;
}

/**
 * An extension's question, docked above the composer. Escape cancels any
 * dialog; Pi resolves a timed-out dialog itself, so the card just closes.
 */
export function DialogCard({ dialog, queued, onRespond }: DialogCardProps) {
  const { request } = dialog;
  const titleId = useId();
  const card = useRef<HTMLElement>(null);
  const respond = (response: RpcExtensionUIResponse) => onRespond(dialog, response);
  const cancel = () => respond(cancelResponse(request.id));

  // Take focus while open, then hand it back (to the composer when the previous holder is gone).
  useEffect(() => {
    const previous = document.activeElement;
    card.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      const target =
        previous instanceof HTMLElement && previous !== document.body && previous.isConnected
          ? previous
          : document.querySelector<HTMLElement>(".composer-input");
      target?.focus();
    };
  }, []);

  let body: ReactNode;
  switch (request.method) {
    case "confirm":
      body = (
        <ConfirmBody
          message={stripAnsi(request.message)}
          onAnswer={(confirmed) => respond(confirmResponse(request.id, confirmed))}
          footer={<Countdown dialog={dialog} queued={queued} onExpire={cancel} />}
        />
      );
      break;
    case "select":
      body = <SelectBody options={request.options} onPick={(value) => respond(valueResponse(request.id, value))} labelledBy={titleId} />;
      break;
    case "input":
    case "editor":
      body = (
        <TextBody
          multiline={request.method === "editor"}
          initial={request.method === "editor" ? (request.prefill ?? "") : ""}
          placeholder={request.method === "input" ? request.placeholder : undefined}
          labelledBy={titleId}
          onSubmit={(value) => respond(valueResponse(request.id, value))}
        />
      );
      break;
  }

  return (
    <section
      ref={card}
      className={`extension-dialog extension-dialog-${request.method}`}
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }}
    >
      <div className="extension-dialog-main">
        <h2 id={titleId} className="extension-dialog-title">
          {stripAnsi(request.title)}
        </h2>
        {body}
      </div>
      {request.method !== "confirm" && (
        <div className="extension-dialog-actions">
          <Countdown dialog={dialog} queued={queued} onExpire={cancel} />
          <button type="button" className="extension-button" onClick={cancel}>
            Cancel
          </button>
          {request.method !== "select" && (
            <button type="submit" className="extension-button extension-button-primary" form={`${titleId}-form`}>
              Submit
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ConfirmBody({ message, footer, onAnswer }: { message: string; footer: ReactNode; onAnswer(confirmed: boolean): void }) {
  return (
    <div className="extension-dialog-row">
      <div className="extension-dialog-text">
        {message && <p className="extension-dialog-message">{message}</p>}
        {footer}
      </div>
      <div className="extension-dialog-buttons">
        <button type="button" className="extension-button" onClick={() => onAnswer(false)}>
          No
        </button>
        <button type="button" className="extension-button extension-button-primary" data-autofocus onClick={() => onAnswer(true)}>
          Yes
        </button>
      </div>
    </div>
  );
}

function SelectBody({ options, labelledBy, onPick }: { options: string[]; labelledBy: string; onPick(value: string): void }) {
  const [active, setActive] = useState(0);
  const id = useId();
  const list = useRef<HTMLUListElement>(null);
  // Focus stays on the list, so keep the highlighted option in view as the arrows move it.
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <ul
      ref={list}
      className="extension-options"
      role="listbox"
      tabIndex={0}
      data-autofocus
      aria-labelledby={labelledBy}
      aria-activedescendant={options.length > 0 ? `${id}-${active}` : undefined}
      onKeyDown={(event) => {
        const target = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: options.length - 1 }[event.key];
        if (target !== undefined && options.length > 0) {
          event.preventDefault();
          setActive((target + options.length) % options.length);
        } else if (event.key === "Enter" && options[active] !== undefined) {
          event.preventDefault();
          onPick(options[active]);
        }
      }}
    >
      {options.map((option, index) => (
        <li
          key={index}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === active}
          className="extension-option"
          onMouseEnter={() => setActive(index)}
          onClick={() => onPick(option)}
        >
          {stripAnsi(option)}
        </li>
      ))}
    </ul>
  );
}

function TextBody(props: { multiline: boolean; initial: string; placeholder?: string; labelledBy: string; onSubmit(value: string): void }) {
  const { multiline, labelledBy, onSubmit } = props;
  const [value, setValue] = useState(props.initial);
  const field = {
    className: multiline ? "extension-field extension-editor" : "extension-field",
    value,
    placeholder: props.placeholder,
    "aria-labelledby": labelledBy,
    "data-autofocus": true,
  };
  return (
    <form
      id={`${labelledBy}-form`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      {multiline ? (
        <textarea
          {...field}
          rows={6}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // Return adds a line in the editor; ⌘/Ctrl+Return submits it.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSubmit(value);
            }
          }}
        />
      ) : (
        <input {...field} type="text" onChange={(event) => setValue(event.target.value)} />
      )}
    </form>
  );
}

/** "Closes in 8s" while a timeout runs, and how many dialogs wait behind this one. */
function Countdown({ dialog, queued, onExpire }: { dialog: PendingDialog; queued: number; onExpire(): void }) {
  const { deadline } = dialog;
  const [now, setNow] = useState(() => Date.now());
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  });
  useEffect(() => {
    if (deadline === undefined) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) {
        window.clearInterval(timer);
        expire.current();
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const parts = [];
  if (deadline !== undefined) parts.push(`Closes in ${Math.max(0, Math.ceil((deadline - now) / 1000))}s`);
  if (queued > 0) parts.push(`${queued} more waiting`);
  if (parts.length === 0) return null;
  return <p className="extension-dialog-meta">{parts.join(" · ")}</p>;
}
