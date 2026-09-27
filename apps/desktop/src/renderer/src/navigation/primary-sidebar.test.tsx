import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UiSessionItem } from "../../session-list.js";
import { applyWorkspaceToggle, PrimarySidebar } from "./primary-sidebar.js";

const sessions: UiSessionItem[] = [
  {
    id: "saved",
    path: "/sessions/saved.jsonl",
    name: "Saved session",
    created: "2026-09-27T08:00:00.000Z",
    modified: "2026-09-27T09:00:00.000Z",
    messageCount: 2,
    persisted: true,
  },
  {
    id: "draft",
    path: "",
    name: "Draft session",
    created: "2026-09-27T10:00:00.000Z",
    modified: "2026-09-27T10:00:00.000Z",
    messageCount: 0,
    persisted: false,
  },
];

describe("PrimarySidebar", () => {
  it("renders current workspace and session semantics with draft metadata", () => {
    const markup = renderToStaticMarkup(
      <PrimarySidebar
        workspaces={[{ name: "apple-pi", path: "/work/apple-pi" }]}
        workspacePath="/work/apple-pi"
        sessions={sessions}
        activeSessionId="saved"
        settingsOpen={false}
        onOpenWorkspace={() => undefined}
        onStartSession={() => undefined}
        onOpenSession={() => undefined}
        onToggleSettings={() => undefined}
      />,
    );

    expect(markup.match(/aria-current="page"/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="apple-pi sessions"');
    expect(markup).toContain('2<span class="sr-only"> messages</span>');
    expect(markup).toContain("Draft");
    expect(markup).toContain('aria-label="New session in apple-pi"');
  });

  it("exposes settings pressed state", () => {
    const markup = renderToStaticMarkup(
      <PrimarySidebar
        workspaces={[]}
        workspacePath=""
        sessions={[]}
        activeSessionId=""
        settingsOpen
        onOpenWorkspace={() => undefined}
        onStartSession={() => undefined}
        onOpenSession={() => undefined}
        onToggleSettings={() => undefined}
      />,
    );

    expect(markup).toContain('aria-pressed="true"');
  });

  it("opens a different workspace on expansion and locally collapses the current one", () => {
    const collapsed: string[] = [];
    const opened: string[] = [];

    applyWorkspaceToggle(
      "/work/api",
      "/work/apple-pi",
      true,
      (path) => collapsed.push(path),
      (path) => opened.push(path),
    );
    applyWorkspaceToggle(
      "/work/apple-pi",
      "/work/apple-pi",
      false,
      (path) => collapsed.push(path),
      (path) => opened.push(path),
    );

    expect(collapsed).toEqual(["", "/work/apple-pi"]);
    expect(opened).toEqual(["/work/api"]);
  });
});
