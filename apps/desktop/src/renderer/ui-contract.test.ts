import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./src/main.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./src/styles.css", import.meta.url), "utf8");
const document = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const rule = (selector: string, source = styles): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

describe("renderer accessibility contract", () => {
  it("exposes selected navigation state to assistive technology", () => {
    expect(source).toContain('aria-current={workspacePath === workspace.path ? "page" : undefined}');
    expect(source).toContain('aria-current={activeSessionId === session.id ? "page" : undefined}');
  });

  it("keeps compact session counts meaningful to assistive technology", () => {
    expect(source).toContain('className="sr-only">{session.messageCount === 1 ? " message" : " messages"}');
  });

  it("labels composer controls", () => {
    expect(source).toContain('name="message"');
    expect(source).toContain('autoComplete="off"');
    expect(source).toContain('ariaLabel="Session model"');
    expect(source).toContain("aria-label={ariaLabel}");
    expect(source).toContain('aria-label="Send message"');
  });

  it("provides an accessible provider onboarding flow", () => {
    const providers = readFileSync(new URL("./src/provider-settings.tsx", import.meta.url), "utf8");
    expect(providers).toContain('type="password"');
    expect(providers).toContain('type="search"');
    expect(providers).toContain("aria-busy={checking}");
    expect(providers).toContain('role={diagnostic.severity === "error" ? "alert" : "status"}');
    expect(source).toContain('<a href="#providers-title">Connect a provider</a>');
  });

  it("announces conversation updates and errors", () => {
    expect(source).toContain('role="log"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="alert"');
  });

  it("uses semantic message attribution instead of a form label", () => {
    expect(source).toContain('<header className="message-author">');
    expect(source).not.toContain("<label><span>");
  });
});

describe("renderer visual contract", () => {
  it("uses a compact single-line conversation header", () => {
    expect(source).not.toContain('state.opened ? "Active session"');
    expect(source).toContain('className="header-context"');
    expect(rule("main")).toContain("grid-template-rows: 48px minmax(0, 1fr) auto");
    expect(rule(".header-title")).toContain("flex-direction: row");
  });

  it("renders ordinary messages without card chrome", () => {
    const userMessage = rule(".message.user .message-content");
    expect(userMessage).not.toContain("border:");
    expect(userMessage).not.toContain("background:");
    expect(userMessage).not.toContain("padding:");
    expect(rule(".message")).toContain("margin: 0 0 22px");
  });

  it("renders tool activity as a disclosure row rather than a card", () => {
    const activity = rule(".tool-activity");
    expect(activity).not.toContain("border:");
    expect(activity).not.toContain("background:");
    expect(rule(".tool-icon")).not.toContain("border:");
    expect(rule(".tool-icon")).not.toContain("background:");
  });

  it("isolates tool statuses from conversation error styling", () => {
    expect(source).toContain("className={`tool-activity status-${item.status}`}");
    expect(source).toContain('className="timeline-error"');
    expect(source).not.toContain("className={`tool-activity ${item.status}`}");
    expect(rule(".timeline-error")).toContain("border: 1px solid #75413a");
  });

  it("uses quiet local focus treatments for tool rows and the composer", () => {
    expect(rule(".timeline:focus-visible")).toContain("box-shadow: inset 2px 0 var(--text-tertiary)");
    expect(rule(".tool-activity summary:focus-visible")).toContain("outline: 0");
    expect(rule(".tool-activity summary:focus-visible")).toContain("box-shadow: inset 2px 0 var(--text-secondary)");
    expect(rule(".composer:focus-within")).toContain("outline: 0");
    expect(rule(".composer:focus-within")).toContain("border-color: var(--text-tertiary)");
    expect(rule(".composer:focus-within")).not.toContain("var(--accent)");
  });

  it("keeps collapsed tool activity visually subordinate to conversation text", () => {
    expect(rule(".tool-activity")).toContain("margin: 0 0 14px");
    expect(rule(".tool-activity summary")).toContain("padding: 2px 0");
    expect(rule(".tool-heading strong")).toContain("color: var(--text-tertiary)");
    expect(rule(".tool-heading strong")).toContain("font-size: 11px");
    expect(rule(".tool-heading code")).toContain("color: var(--text-tertiary)");
    expect(rule(".tool-status")).toContain("color: var(--text-tertiary)");
    expect(rule(".tool-activity summary:hover .tool-heading strong")).toContain("color: var(--text-secondary)");
    expect(rule(".tool-icon")).toContain("width: 20px");
  });

  it("keeps the composer compact and reserves emphasis for focus", () => {
    expect(rule(".composer textarea")).toContain("min-height: 42px");
    expect(rule(".composer")).not.toContain("box-shadow:");
    expect(rule(".composer:focus-within")).toContain("border-color:");
  });

  it("uses compact navigation and plain settings content", () => {
    expect(rule(".shell")).toContain("grid-template-columns: 248px minmax(0, 1fr)");
    expect(source).toContain('className="session-meta"');
    expect(rule(".settings-card")).not.toContain("border:");
    expect(rule(".settings-card")).not.toContain("background:");
  });

  it("omits implementation-status copy from the sidebar", () => {
    expect(source).not.toContain("Local agent");
    expect(source).not.toContain("Running locally");
    expect(styles).not.toContain(".local-status");
  });

  it("prioritizes the session title over workspace context on narrow screens", () => {
    const narrowScreenRules = styles.match(/@media \(max-width: 620px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(rule(".header-context", narrowScreenRules)).toContain("display: none;");
  });

  it("keeps the chat composer inside the viewport while messages scroll", () => {
    const mainRule = rule("main");
    const timelineRule = rule(".timeline");

    expect(mainRule).toContain("min-height: 0");
    expect(mainRule).toContain("overflow: hidden");
    expect(timelineRule).toContain("min-height: 0");
    expect(timelineRule).toContain("overflow: auto");
  });

  it("uses a local system type stack and explicit readable type tokens", () => {
    expect(styles).not.toContain("fonts.googleapis.com");
    expect(styles).toContain("--text-body: 15px");
    expect(styles).toContain("--text-ui: 14px");
    expect(styles).toContain("--text-meta: 12px");
  });

  it("provides component-level focus treatments", () => {
    expect(styles).toContain(".composer:focus-within");
    expect(styles).toContain(".model-select:focus-visible");
  });

  it("optimizes long conversation rendering", () => {
    expect(styles).toContain("content-visibility: auto");
    expect(styles).toContain("contain-intrinsic-size");
  });

  it("sets native dark chrome metadata", () => {
    expect(document).toContain('<meta name="theme-color" content="#0b0d0d">');
  });
});

describe("renderer model recovery contract", () => {
  it("clears a stale default model after any authoritative model list load, not only after a manual refresh", () => {
    expect(source).toContain("[models, catalog.defaultModel]");
    expect(source).toContain("void window.applePi.model.clearDefault().then(setCatalog);");
  });

  it("guards provider-triggered model refreshes against stale out-of-order responses", () => {
    expect(source).toContain("const modelsRefreshToken = useRef(0);");
    expect(source).toContain("if (modelsRefreshToken.current !== token) return;");
  });

  it("tells the user when the active session's model is no longer available", () => {
    expect(source).toContain("const activeModelUnavailable = state.opened && modelUnavailable(models, state.model);");
    expect(source).toContain('className="model-unavailable-notice"');
  });
});

describe("renderer credential reuse contract", () => {
  it("reloads provider and model state whenever Settings is opened, to reflect external CLI credential and models.json changes", () => {
    expect(source).toContain("if (!settingsOpen) return;");
    expect(source).toContain("window.applePi.provider\n      .refreshModels()");
    expect(source).toContain("}, [settingsOpen]);");
  });

  it("labels a shell-command-backed credential distinctly from a stored key or environment variable", () => {
    const providers = readFileSync(new URL("./src/provider-settings.tsx", import.meta.url), "utf8");
    expect(providers).toContain('command: "Shell command",');
  });
});

describe("renderer feedback contract", () => {
  it("resyncs only after the reducer marks a gap or explicit resync event", () => {
    expect(source).toContain('if (state.sync.status !== "resyncing") return;');
    expect(source).toContain("runSessionResync(");
    expect(source).toContain("[state.sync.status, state.sync.generation]");
    expect(source).not.toContain(
      'dispatch({ type: "event", sequence: event.sequence, payload: event.payload });\n      void window.applePi.session.getSnapshot()',
    );
  });

  it("offers explicit recovery after a resync failure", () => {
    expect(source).toContain('state.sync.status === "failed"');
    expect(source).toContain('dispatch({ type: "retry_resync" })');
    expect(rule(".app-error button")).toContain("pointer-events: auto");
  });

  it("keeps a sent user message visible while agent events stream", () => {
    expect(source).toContain('dispatch({ type: "user_message", text });');
  });

  it("exposes a shared pending state", () => {
    expect(source).toContain('const [pendingLabel, setPendingLabel] = useState("")');
    expect(source).toContain("aria-busy={Boolean(pendingLabel)}");
    expect(source).toContain('className="app-status"');
  });

  it("shows settings save progress and confirmation", () => {
    expect(source).toContain('setPendingLabel("Saving default model…")');
    expect(source).toContain('setNotice("Default model saved")');
  });

  it("keeps errors visible outside individual views", () => {
    expect(source).toContain('className="app-error"');
    expect(source).toContain("Something went wrong.");
  });
});
