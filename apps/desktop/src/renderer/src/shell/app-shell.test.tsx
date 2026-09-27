import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell.js";
import { ContentHeader } from "./content-header.js";

describe("AppShell", () => {
  it("keeps pending and failure feedback in their live regions", () => {
    const markup = renderToStaticMarkup(
      <AppShell
        busyLabel="Opening workspace…"
        notice=""
        error="The session could not be opened."
        onRetry={() => undefined}
        sidebar={<aside>Navigation</aside>}
        header={<header>Header</header>}
      >
        <section>Content</section>
      </AppShell>,
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Opening workspace…");
    expect(markup).toContain("The session could not be opened.");
    expect(markup).toContain(">Retry</button>");
  });
});

describe("ContentHeader", () => {
  it("renders conversation ownership and session cancellation", () => {
    const markup = renderToStaticMarkup(
      <ContentHeader
        title={{ kind: "conversation", workspaceName: "apple-pi", workspacePath: "/work/apple-pi", sessionName: "Renderer extraction" }}
        running
        onCancel={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain('title="/work/apple-pi"');
    expect(markup).toContain("apple-pi");
    expect(markup).toContain("Renderer extraction");
    expect(markup).toMatch(/class="cancel"[\s\S]* Stop<\/button>/);
    expect(markup).not.toContain("Close settings");
  });

  it("labels mode-specific close actions", () => {
    const settings = renderToStaticMarkup(<ContentHeader title={{ kind: "settings" }} running={false} onCancel={() => undefined} onClose={() => undefined} />);
    const skills = renderToStaticMarkup(
      <ContentHeader title={{ kind: "workspace-skills" }} running={false} onCancel={() => undefined} onClose={() => undefined} />,
    );

    expect(settings).toContain('aria-label="Close settings"');
    expect(skills).toContain('aria-label="Close workspace skills"');
  });
});
