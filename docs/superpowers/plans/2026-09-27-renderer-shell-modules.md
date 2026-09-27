# Renderer Shell Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Apple Pi's renderer shell and navigation into focused, typed presentation modules without moving orchestration or changing behavior.

**Architecture:** Keep all catalog, workspace, session, model, IPC, persistence, and asynchronous operation state in `App`. Compose it through an `AppShell`, `ContentHeader`, `PrimarySidebar`, `WorkspaceRow`, `SessionList`/`SessionRow`, and `SettingsNavigation`, each accepting only render data and callbacks. Co-locate shell and navigation styles and focused render/interaction-contract tests with those modules.

**Tech Stack:** React 19, TypeScript, Vitest, React DOM server rendering, Electron/Vite, CSS.

**Spec:** GitHub issues #105 and #108.

## Global Constraints

- Preserve the semantic tokens, deterministic fixtures, content modes, and workspace/session hierarchy shipped by #111 and #106.
- Presentation modules must not receive complete App state, call `window.applePi`/IPC, persist data, or own external state.
- Preserve drag/no-drag regions, scrolling ownership, responsive/minimum-window behavior, focus return, keyboard/current semantics, live status, cancellation, and cross-platform packaging assumptions.
- Do not restyle broadly or absorb conversation work from #107.

## Review Focus

- A selected workspace that is locally collapsed must retain its session count, start action, and disclosure keyboard behavior.
- A persisted and a draft session must retain distinct accessible labels and current-page semantics.
- Settings and workspace-skills modes must expose the correct close label while a running conversation retains Stop.
- Long workspace/session names must stay in the same truncating and locally scrolling owners.
- App-level pending, success, sync-failure, and retry feedback must retain polite/alert semantics.

---

### Task 1: Characterize the presentation contracts

**Files:**
- Create: `apps/desktop/src/renderer/src/shell/app-shell.test.tsx`
- Create: `apps/desktop/src/renderer/src/navigation/primary-sidebar.test.tsx`
- Create: `apps/desktop/src/renderer/src/settings/settings-navigation.test.tsx`

**Interfaces:**
- Consumes: Current #106 renderer semantics and fixture data shapes.
- Produces: Failing render contracts for the extracted modules and keyboard disclosure helper.

- [ ] Write server-rendered markup and pure keyboard-intent tests covering the Review Focus cases.
- [ ] Run the focused tests and verify they fail because the new module entry points do not exist.

### Task 2: Extract shell and navigation presentation

**Files:**
- Create: `apps/desktop/src/renderer/src/shell/app-shell.tsx`
- Create: `apps/desktop/src/renderer/src/shell/content-header.tsx`
- Create: `apps/desktop/src/renderer/src/shell/shell.css`
- Create: `apps/desktop/src/renderer/src/navigation/primary-sidebar.tsx`
- Create: `apps/desktop/src/renderer/src/navigation/workspace-row.tsx`
- Create: `apps/desktop/src/renderer/src/navigation/session-list.tsx`
- Create: `apps/desktop/src/renderer/src/navigation/session-row.tsx`
- Create: `apps/desktop/src/renderer/src/navigation/navigation.css`
- Create: `apps/desktop/src/renderer/src/settings/settings-navigation.tsx`
- Modify: `apps/desktop/src/renderer/src/main.tsx`
- Modify: `apps/desktop/src/renderer/src/settings-shell.tsx`
- Modify: `apps/desktop/src/renderer/src/styles.css`
- Delete: `apps/desktop/src/renderer/src/app-sidebar.tsx`

**Interfaces:**
- Consumes: Narrow catalog/workspace/session/mode/status values and callbacks owned by `App`.
- Produces: Focused typed components with no IPC/global-state access.

- [ ] Implement the minimal modules required by the failing tests.
- [ ] Compose them from `App` and `SettingsShell` without moving orchestration callbacks.
- [ ] Move only the selectors owned by these modules into co-located stylesheets.
- [ ] Run focused tests and verify they pass; then run the renderer test suite.

### Task 3: Migrate deterministic fixtures and verify the branch

**Files:**
- Modify: `apps/desktop/src/renderer/src/visual-fixtures.tsx`
- Modify: `apps/desktop/src/renderer/ui-contract.test.ts`
- Modify: `docs/renderer-ui-conventions.md`

**Interfaces:**
- Consumes: Extracted shell/navigation public surfaces.
- Produces: Deterministic fixture coverage and documented module ownership.

- [ ] Migrate navigation/conversation fixtures to the extracted modules and update boundary assertions.
- [ ] Run formatting, lint, typecheck, all tests, docs checks, and the production build.
- [ ] Review the final diff for IPC leakage, styling drift, and issue #107 scope creep.
- [ ] Commit, push, open the issue-linked pull request, and attach it to this task.
