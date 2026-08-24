import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./src/main.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./src/styles.css", import.meta.url), "utf8");
const document = readFileSync(new URL("./index.html", import.meta.url), "utf8");

describe("renderer accessibility contract", () => {
  it("exposes selected navigation state to assistive technology", () => {
    expect(source).toContain('aria-current={workspacePath === workspace.path ? "page" : undefined}');
    expect(source).toContain('aria-current={activeSessionId === session.id ? "page" : undefined}');
  });

  it("labels composer controls", () => {
    expect(source).toContain('name="message"');
    expect(source).toContain('autoComplete="off"');
    expect(source).toContain('ariaLabel="Session model"');
    expect(source).toContain('aria-label={ariaLabel}');
    expect(source).toContain('aria-label="Send message"');
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

describe("renderer feedback contract", () => {
  it("exposes a shared pending state", () => {
    expect(source).toContain('const [pendingLabel, setPendingLabel] = useState("")');
    expect(source).toContain('aria-busy={Boolean(pendingLabel)}');
    expect(source).toContain('className="app-status"');
  });

  it("shows settings save progress and confirmation", () => {
    expect(source).toContain('setPendingLabel("Saving default model…")');
    expect(source).toContain('setNotice("Default model saved")');
  });

  it("keeps errors visible outside individual views", () => {
    expect(source).toContain('className="app-error"');
    expect(source).toContain('Something went wrong.');
  });
});
