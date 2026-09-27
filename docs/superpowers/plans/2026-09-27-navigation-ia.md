# Navigation IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add explicit renderer content modes and a compact, accessible workspace/session disclosure hierarchy without changing Apple Pi's IPC or session behavior.

**Architecture:** Keep orchestration and external state in `main.tsx`, model navigation transitions in a small pure typed module, and keep disclosure/menu presentation in `AppSidebar`. The sidebar receives only catalog/session data and callbacks; deterministic fixtures exercise the finished hierarchy at supported window sizes.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Electron Vite

**Spec:** GitHub issues #105 and #106

## Global Constraints

- Reuse the semantic tokens and deterministic visual-fixture conventions merged in #111.
- Preserve IPC, session/workspace behavior, focus, live regions, scrolling ownership, loading/error states, and the 760×560 minimum window.
- Presentation components receive narrow typed data and callbacks and never access IPC or persistence.
- Do not absorb shell extraction from #108 or create a speculative component library.

## Review Focus

- Switching workspaces while Workspace Skills is visible must not retain content owned by the previous workspace.
- Only the active/expanded workspace may expose the current session list; collapsing it must not lose active ownership.
- Arrow Right/Left and Escape on workspace disclosures must expand/collapse predictably without breaking ordinary button activation.
- Long workspace/session names must truncate visually while retaining accessible full values.
- 800×600 must keep scrolling inside the workspace tree or main content, never at page level.

---

### Task 1: Typed content navigation state

**Files:**
- Create: `apps/desktop/src/renderer/content-mode.ts`
- Test: `apps/desktop/src/renderer/content-mode.test.ts`
- Modify: `apps/desktop/src/renderer/src/main.tsx`

**Interfaces:**
- Produces: `ContentMode`, `SettingsSection`, `conversationMode`, `workspaceSkillsMode(path)`, and workspace-safe mode transition helpers.
- Consumes: existing workspace/session orchestration callbacks in `main.tsx`.

- [x] **Step 1: Write failing tests** for explicit mode ownership, settings sections, workspace changes, and stale Workspace Skills cleanup.
- [x] **Step 2: Run `pnpm --filter @apple-pi/desktop exec vitest run src/renderer/content-mode.test.ts` and confirm the missing-module failure.**
- [x] **Step 3: Implement the minimal typed state module and replace `settingsOpen`/`workspaceSkillsOpen` branches without changing IPC calls.**
- [x] **Step 4: Run the focused test and desktop typecheck; expect both to pass.**

### Task 2: Workspace/session disclosure hierarchy

**Files:**
- Modify: `apps/desktop/src/renderer/src/app-sidebar.tsx`
- Modify: `apps/desktop/src/renderer/src/styles.css`
- Modify: `apps/desktop/src/renderer/ui-contract.test.ts`

**Interfaces:**
- Consumes: active workspace path, active session id, sessions, and existing callbacks.
- Produces: one expanded workspace disclosure, its one-level-indented session list, row-level new-session/count/actions, and keyboard disclosure behavior.

- [x] **Step 1: Add failing UI contract tests** for no Sessions heading/rail, flush workspace rows, single nested list, disclosure semantics/keys, row-level action/count placement, title values, and local overflow ownership.
- [x] **Step 2: Run the focused contract tests and confirm they fail for the current separate Sessions section.**
- [x] **Step 3: Implement the compact hierarchy in `AppSidebar` and semantic-token styles; keep session/workspace callbacks unchanged.**
- [x] **Step 4: Run the focused tests and desktop typecheck; expect both to pass.**

### Task 3: Deterministic navigation fixture and integrated verification

**Files:**
- Modify: `apps/desktop/src/renderer/src/visual-fixtures.tsx`
- Modify: `apps/desktop/src/renderer/visual-fixtures.json`
- Modify: `apps/desktop/src/renderer/src/visual-fixtures.css`

**Interfaces:**
- Consumes: `AppSidebar` public props.
- Produces: deterministic long-content/focus navigation fixture at all established viewports.

- [x] **Step 1: Add the navigation fixture id and failing fixture contract assertion.**
- [x] **Step 2: Run the focused test and confirm failure because the fixture is not implemented.**
- [x] **Step 3: Implement the deterministic fixture using the real sidebar, including long names, sessions, selected ownership, and focus.**
- [x] **Step 4: Run fixture generation/capture checks available in the repository, then `pnpm verify`; expect zero failures.**
- [x] **Step 5: Review the diff against #105/#106, request independent code review, fix important findings, commit, push, and open a PR linked to #106.**
