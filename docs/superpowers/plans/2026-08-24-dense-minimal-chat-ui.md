# Dense Minimal Chat UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reduce container chrome and vertical waste so Apple Pi reads as a dense, text-first agent interface.

**Architecture:** Keep the existing React structure and three-row chat grid, but simplify the header markup and replace card-like CSS with typography, indentation, and state color. Preserve semantic controls, focus treatments, scroll ownership, and expandable tool details.

**Tech Stack:** React 19, TypeScript, Electron, CSS, Vitest

**Spec:** User-approved design audit in the 2026-08-24 task conversation.

## Global Constraints

- Ordinary user and assistant messages have no border or container background.
- The conversation header is one compact line and does not display “Active session”.
- Tool calls remain expandable and communicate running, success, and failure without a card border.
- The composer keeps a clear input boundary and visible focus state while using less height and chrome.
- Existing accessibility labels, keyboard behavior, dark mode, responsive behavior, and reduced-motion handling remain intact.

---

### Task 1: Compact conversation structure

**Files:**
- Modify: `apps/desktop/src/renderer/src/main.tsx:271-327`
- Modify: `apps/desktop/src/renderer/src/styles.css:53-124`
- Test: `apps/desktop/src/renderer/ui-contract.test.ts`

**Interfaces:**
- Consumes: existing `workspacePath`, `sessions`, `activeSessionId`, and `timelineItems`
- Produces: a one-line conversation header and dense borderless timeline

- [x] **Step 1: Add failing visual-contract assertions**

Assert that the renderer omits the `Active session` copy, uses a compact header row, and removes the user-message border/background/padding contract.

- [x] **Step 2: Run the renderer contract test**

Run: `pnpm --filter @apple-pi/desktop test -- ui-contract.test.ts`

Expected: FAIL because the current header is 80px, contains `Active session`, and user messages are card styled.

- [x] **Step 3: Implement compact header and message flow**

Render workspace name and session title on one line, retain the full path in `title`, reduce header and timeline padding, and use typography and rhythm instead of message borders.

- [x] **Step 4: Run the renderer contract test**

Run: `pnpm --filter @apple-pi/desktop test -- ui-contract.test.ts`

Expected: PASS.

### Task 2: Reduce tool and composer chrome

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles.css:85-124`
- Test: `apps/desktop/src/renderer/ui-contract.test.ts`

**Interfaces:**
- Consumes: existing semantic `details`, `summary`, textarea, model select, and send button markup
- Produces: an unboxed tool disclosure row and compact input surface

- [x] **Step 1: Add failing visual-contract assertions**

Assert that tool activity has no outer border/background and that the composer uses a smaller textarea minimum height without its current heavy shadow.

- [x] **Step 2: Run the renderer contract test**

Run: `pnpm --filter @apple-pi/desktop test -- ui-contract.test.ts`

Expected: FAIL against the current card and composer styles.

- [x] **Step 3: Implement the minimal styling changes**

Use status color and indentation for tool hierarchy, keep bounded output surfaces, reduce composer height, and reserve the accent outline for focus.

- [x] **Step 4: Run the renderer contract test**

Run: `pnpm --filter @apple-pi/desktop test -- ui-contract.test.ts`

Expected: PASS.

### Task 3: Simplify navigation and settings chrome

**Files:**
- Modify: `apps/desktop/src/renderer/src/main.tsx:228-289`
- Modify: `apps/desktop/src/renderer/src/styles.css:21-51,126-140`
- Test: `apps/desktop/src/renderer/ui-contract.test.ts`

**Interfaces:**
- Consumes: existing sidebar buttons, navigation state, settings controls, and feedback state
- Produces: compact single-line session rows, lighter workspace action, borderless settings content, and lower-chrome feedback

- [x] **Step 1: Add failing visual-contract assertions**

Assert the narrower sidebar, single-line session metadata, and borderless settings surface.

- [x] **Step 2: Run the renderer contract test**

Run: `pnpm --filter @apple-pi/desktop test -- ui-contract.test.ts`

Expected: FAIL against current two-line session and card styles.

- [x] **Step 3: Implement navigation and settings simplification**

Move session count inline, reduce sidebar width and padding, remove the workspace button border, and render settings as a plain content section.

- [x] **Step 4: Run all desktop verification**

Run: `pnpm --filter @apple-pi/desktop test && pnpm --filter @apple-pi/desktop typecheck && pnpm --filter @apple-pi/desktop build && git diff --check`

Expected: all commands exit 0.
