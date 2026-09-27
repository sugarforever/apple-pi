// @vitest-environment happy-dom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { UiSessionItem } from "../../session-list.js";
import { getWorkspaceDisclosureIntent, WorkspaceRow } from "./workspace-row.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: UiSessionItem = {
  id: "saved",
  path: "/sessions/saved.jsonl",
  name: "Saved session",
  created: "2026-09-27T08:00:00.000Z",
  modified: "2026-09-27T09:00:00.000Z",
  messageCount: 2,
  persisted: true,
};

describe("workspace disclosure keyboard behavior", () => {
  it("expands collapsed workspaces with ArrowRight", () => {
    expect(getWorkspaceDisclosureIntent("ArrowRight", false)).toBe("expand");
    expect(getWorkspaceDisclosureIntent("ArrowRight", true)).toBeUndefined();
  });

  it("collapses expanded workspaces with ArrowLeft or Escape", () => {
    expect(getWorkspaceDisclosureIntent("ArrowLeft", true)).toBe("collapse");
    expect(getWorkspaceDisclosureIntent("Escape", true)).toBe("collapse");
    expect(getWorkspaceDisclosureIntent("ArrowLeft", false)).toBeUndefined();
    expect(getWorkspaceDisclosureIntent("Escape", false)).toBeUndefined();
  });

  it("leaves ordinary button keys to native activation", () => {
    expect(getWorkspaceDisclosureIntent("Enter", false)).toBeUndefined();
    expect(getWorkspaceDisclosureIntent(" ", true)).toBeUndefined();
  });
});

describe("WorkspaceRow interactions", () => {
  it("delivers new-session and session-row activation through mounted controls", () => {
    let starts = 0;
    const opened: string[] = [];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <WorkspaceRow
          workspace={{ name: "apple-pi", path: "/work/apple-pi" }}
          selected
          expanded
          sessions={[session]}
          activeSessionId="saved"
          onToggle={() => undefined}
          onOpenSkills={() => undefined}
          onStartSession={() => {
            starts += 1;
          }}
          onOpenSession={(item) => opened.push(item.id)}
        />,
      );
    });

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="New session in apple-pi"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('[title="Saved session"]')!.click());

    expect(starts).toBe(1);
    expect(opened).toEqual(["saved"]);
    act(() => root.unmount());
    container.remove();
  });

  it("closes its mounted menu on Escape and returns focus to the trigger", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <WorkspaceRow
          workspace={{ name: "apple-pi", path: "/work/apple-pi" }}
          selected
          expanded
          sessions={[]}
          activeSessionId=""
          onToggle={() => undefined}
          onOpenSkills={() => undefined}
          onStartSession={() => undefined}
          onOpenSession={() => undefined}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="More actions for apple-pi"]')!;
    act(() => trigger.click());
    expect(container.querySelector('[role="menu"]')).not.toBeNull();

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    act(() => root.unmount());
    container.remove();
  });
});
