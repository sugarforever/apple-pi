# App-Wide Design Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved design review across Apple Pi’s sidebar, header, welcome state, conversation, composer, settings, and feedback states.

**Architecture:** Keep the existing single-renderer architecture and behavior. Add explicit accessibility state in React, introduce a small async-status model shared by workspace/session/model actions, and replace the compressed CSS with readable design tokens and component rules.

**Tech Stack:** React 19, TypeScript, Electron, CSS, Vitest

**Spec:** User-approved findings in the 2026-08-24 app-wide design review in this task.

## Global Constraints

- Preserve the dark local-agent visual identity and lime accent.
- Use the system UI font for interface text and IBM Plex Mono only for technical content.
- Use explicit 14–15px reading/navigation text and 11–12px metadata.
- Preserve existing workspace, session, model, send, and cancel behavior.
- Add no runtime dependency.

---

### Task 1: Renderer accessibility contract

**Files:**
- Create: `apps/desktop/src/renderer/ui-contract.test.ts`
- Modify: `apps/desktop/src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: Existing React renderer markup.
- Produces: Accessible selected states, labeled controls, live feedback, and semantic message headers.

- [x] **Step 1: Write failing renderer-contract tests**
- [x] **Step 2: Run the focused test and confirm expected failures**
- [x] **Step 3: Add accessible names, current states, live regions, and form metadata**
- [x] **Step 4: Run the focused test and confirm it passes**

### Task 2: Unified typography and layout

**Files:**
- Modify: `apps/desktop/src/renderer/ui-contract.test.ts`
- Modify: `apps/desktop/src/renderer/src/styles.css`
- Modify: `apps/desktop/src/renderer/index.html`

**Interfaces:**
- Consumes: Existing class names plus accessibility classes from Task 1.
- Produces: Readable type tokens, contrast tokens, visible focus states, stacked settings, responsive layout, and CSP-compatible font behavior.

- [x] **Step 1: Write failing CSS and document-contract tests**
- [x] **Step 2: Run the focused test and confirm expected failures**
- [x] **Step 3: Implement readable CSS and document metadata**
- [x] **Step 4: Run the focused test and confirm it passes**

### Task 3: Async feedback and final verification

**Files:**
- Modify: `apps/desktop/src/renderer/ui-contract.test.ts`
- Modify: `apps/desktop/src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: Existing async workspace/session/model operations.
- Produces: Visible pending and error feedback in every view.

- [x] **Step 1: Write failing feedback-state tests**
- [x] **Step 2: Run the focused test and confirm expected failures**
- [x] **Step 3: Implement shared pending and status feedback**
- [x] **Step 4: Run focused and full tests**
- [x] **Step 5: Run typecheck and production build**
