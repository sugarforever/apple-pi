# Renderer Apple Pi Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the renderer incrementally consume only Apple Pi-owned session snapshots, events, messages, and tool activity values, fetching a full snapshot only after a sequence gap or explicit resync request.

**Architecture:** Keep runtime decoding at the host boundary and use the protocol's closed discriminated unions throughout renderer state and timeline projection. The reducer applies safe ordered deltas locally, marks only gaps and `resync_required` events for refresh, and a React effect performs the requested resync once per refresh transition.

**Tech Stack:** TypeScript 5.9, React 19, Electron, TypeBox protocol types, Vitest

**Spec:** GitHub Issue #5 and `docs/superpowers/plans/2026-09-12-close-pi-adapter-boundary.md` Task 5

## Global Constraints

- Preserve existing UI rendering and interaction behavior.
- Do not import or probe Pi SDK `toolCall`, `toolResult`, or role shapes in the renderer.
- Use `SessionSnapshot`, `ApplePiSessionEvent`, `ApplePiMessage`, and tool content types exported by `@apple-pi/protocol`.
- Fetch a full session snapshot only for an event sequence gap or `resync_required`.
- Follow red-green-refactor and record the failing test evidence before implementation.

---

### Task 1: Lock the renderer event and timeline contracts

**Files:**
- Modify: `apps/desktop/src/renderer/session-state.test.ts`
- Modify: `apps/desktop/src/renderer/tool-activity.test.ts`
- Modify: `apps/desktop/src/renderer/ui-contract.test.ts`

**Interfaces:**
- Consumes: `SessionSnapshot`, `ApplePiSessionEvent`, and `ApplePiMessage` from `@apple-pi/protocol`.
- Produces: behavioral coverage for every event and content discriminator, ordered events, duplicate events, sequence gaps, explicit resync, and snapshot recovery.

- [x] **Step 1: Add typed Apple Pi fixtures and failing reducer tests** that prove text/thinking/tool/lifecycle deltas mutate state directly, duplicates are ignored, and gaps/resync set `needsRefresh` without applying unsafe deltas.
- [x] **Step 2: Add timeline discriminator coverage** using only `text`, `thinking`, `tool_call`, and `tool_result` Apple Pi content parts, with literal expected UI items.
- [x] **Step 3: Add a UI contract test** proving event subscription dispatches locally and snapshot fetching lives behind reducer sync state, not directly in the subscription callback.
- [x] **Step 4: Run `pnpm --filter @apple-pi/desktop test`** and confirm failures are caused by the missing incremental event handling and conditional resync behavior.

### Task 2: Implement exhaustive incremental renderer state

**Files:**
- Modify: `apps/desktop/src/renderer/session-state.ts`
- Modify: `apps/desktop/src/renderer/tool-activity.ts`
- Verify: `apps/desktop/src/renderer/global.d.ts` already exposes protocol-owned host event and snapshot types
- Modify: `apps/desktop/src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: `SessionAction` carrying protocol-owned `ApplePiSessionEvent` values.
- Produces: `reduceSession(state, action): SessionState`, where ordered deltas update local messages and only gap/resync paths set `needsRefresh`.

- [x] **Step 1: Implement closed event switches** with a `never` exhaustiveness guard and immutable helpers for assistant stream parts and tool results.
- [x] **Step 2: Preserve sequence safety** by ignoring duplicates, withholding gapped events, and retaining refresh state until a snapshot replaces the projection.
- [x] **Step 3: Make timeline content handling exhaustive** over protocol message/content unions without record probing or local agent-domain duplicates.
- [x] **Step 4: Move snapshot refresh behind the reducer's discriminated sync state** and keep normal ordered event delivery local.
- [x] **Step 5: Run focused renderer tests** until green, then run protocol tests to guard the shared discriminator contract.

### Task 3: Verify and deliver

**Files:**
- Verify: all files changed by Tasks 1–2

**Interfaces:**
- Consumes: the completed renderer migration.
- Produces: reviewable commit and a non-draft pull request closing Issue #5.

- [x] **Step 1: Run renderer/UI contract tests, protocol tests, `pnpm typecheck`, `pnpm build`, the feasible full test suite, and `git diff --check`.**
- [x] **Step 2: Scan renderer sources** for Pi-shaped `toolCall`/`toolResult`, agent-domain `unknown`, and duplicate session snapshot declarations.
- [x] **Step 3: Request independent code review** against Issue #5 and address every Critical or Important finding.
- [x] **Step 4: Commit, push `codex/issue-5-renderer-domain`, and create a non-draft PR** with summary, verification evidence, and `Closes #5`.

**TDD evidence:** RED runs failed for missing discriminator handling, gap/resync behavior, in-flight snapshot races, explicit retry, resync coordination, and clickable recovery UI before their implementations were added. GREEN verification commands and counts are recorded in PR #14.
