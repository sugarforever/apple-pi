# Deterministic Session Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each Pi session and agent-host process one deterministic owner so replacement and shutdown release resources and pending work exactly once.

**Architecture:** `PiSessionService` will serialize lifecycle operations, create a replacement before committing it, guard event forwarding by owner identity, and release the displaced owner through one idempotent unsubscribe/abort/dispose path. Protocol v1 gains an additive `system.shutdown` command; the host closes the adapter before acknowledging it, while `AgentHostSupervisor` waits a bounded interval for normal process exit and only then sends a kill signal.

**Tech Stack:** TypeScript 5.9, Vitest 4, Node.js child processes, TypeBox protocol schemas, pnpm workspaces.

**Spec:** GitHub Issue #6 and `docs/superpowers/plans/2026-09-12-close-pi-adapter-boundary.md` Task 6 (read from repository history at `fa95235`).

## Global Constraints

- Start from the latest `origin/main` (`4a64bf8`).
- Preserve Protocol v1 and add only schema-validated Apple Pi-owned values.
- Pi SDK imports and types remain confined to `packages/pi-adapter`.
- Prove each behavior with a failing test before production changes.
- Create a non-draft PR containing validation evidence and `Closes #6`; do not merge it.

---

### Task 1: Serialize and Own Pi Sessions

**Files:**
- Create: `packages/pi-adapter/src/session-service.test.ts`
- Modify: `packages/pi-adapter/src/index.ts`

**Interfaces:**
- Consumes: Pi's `AgentSession.subscribe`, `abort`, and synchronous `dispose`; Apple Pi `SessionSnapshot` and `ApplePiSessionEvent`.
- Produces: unchanged public `PiSessionService.open()` and `close()` APIs with serialized, idempotent ownership semantics.

- [ ] **Step 1: Write failing lifecycle tests** using complete Pi session doubles. Prove that replacing a streaming session invokes unsubscribe, abort, and dispose once; a captured stale callback cannot publish; concurrent opens commit in call order; creation failure leaves the old owner subscribed and usable; and repeated close releases the current owner once.
- [ ] **Step 2: Run `pnpm --filter @apple-pi/pi-adapter test -- src/session-service.test.ts`** and confirm failures identify current eager unsubscribe, missing dispose, stale publication, and non-idempotent close behavior.
- [ ] **Step 3: Implement the minimal owner record and serialized operation queue.** Construct candidates while the old owner remains active, atomically install the candidate subscription, then detach and release the old owner. On candidate creation failure, preserve the old owner. Clear ownership before close cleanup and gate callbacks on current owner identity.
- [ ] **Step 4: Run the focused adapter test and all adapter tests** until green, then refactor only duplicated test setup or lifecycle cleanup while keeping the suite green.

### Task 2: Add a Graceful Host Shutdown Contract

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/protocol.test.ts`
- Modify: `apps/agent-host/src/server.ts`
- Modify: `apps/agent-host/src/server.test.ts`
- Modify: `apps/agent-host/src/index.ts`

**Interfaces:**
- Consumes: `PiSessionService.close(): Promise<void>`.
- Produces: Protocol v1 command `system.shutdown` with `{}` payload/result and a host response emitted only after adapter cleanup.

- [ ] **Step 1: Add failing protocol and host tests.** Decode `system.shutdown`, reject extra fields, and prove `HostServer.handle()` awaits exactly one adapter close before returning its success response.
- [ ] **Step 2: Run protocol and host focused tests** and confirm failure because `system.shutdown` is not yet in the command/result maps or server switch.
- [ ] **Step 3: Add the command schemas and minimal server branch.** Keep the result Apple Pi-owned (`{}`) and expose `HostServer.close()` as the sole adapter shutdown owner.
- [ ] **Step 4: Make the JSONL entrypoint write the shutdown response before allowing the process to exit.** Do not alter response/event framing for existing commands.
- [ ] **Step 5: Run protocol and host suites** and confirm all prior Protocol v1 behavior remains green.

### Task 3: Bound Supervisor Shutdown and Reject Pending Work Once

**Files:**
- Modify: `apps/desktop/src/main/agent-host-supervisor.test.ts`
- Modify: `apps/desktop/src/main/agent-host-supervisor.ts`
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**
- Consumes: `system.shutdown`, child `exit`, and existing pending request ownership.
- Produces: `AgentHostSupervisor.stop(): Promise<void>` that rejects pending business requests once, waits for graceful exit, and kills only after the configured timeout.

- [ ] **Step 1: Add failing supervisor tests.** Prove graceful stop sends `system.shutdown`, rejects each pre-existing pending request once, emits one disconnect, avoids `kill()` when exit arrives in bounds, falls back to one `kill()` after the deadline, and repeated stop calls share one shutdown.
- [ ] **Step 2: Run the focused desktop test** and confirm current immediate-kill implementation fails the graceful and idempotent assertions.
- [ ] **Step 3: Implement a single shared stop promise.** Revoke readiness first, snapshot/clear and reject business pending work once, register the exit waiter, send the shutdown request outside the normal pending map, race exit against a bounded timer, and force-kill once only on timeout.
- [ ] **Step 4: Await shutdown from Electron's `before-quit` path** using a re-entry guard so application exit does not bypass graceful cleanup.
- [ ] **Step 5: Run desktop tests after building required artifacts** and preserve stale-child callback guards and protocol-fault semantics.

### Task 4: Verify, Review, and Publish

**Files:**
- Review all changed files; no new interface is introduced in this task.

**Interfaces:**
- Consumes: completed Tasks 1–3.
- Produces: a reviewed commit and non-draft PR closing Issue #6.

- [ ] **Step 1: Run focused adapter, host, and supervisor tests**, then `pnpm typecheck`, `pnpm build`, and `pnpm test` in that order so generated package and preload artifacts exist.
- [ ] **Step 2: Inspect `git diff --check`, `git status`, and the complete diff** for Pi type leakage, duplicate cleanup, stale event publication, timers left referenced, and unrelated changes.
- [ ] **Step 3: Request a code review** against `origin/main`; fix every Critical or Important finding through a new failing test where behavior changes.
- [ ] **Step 4: Repeat the complete verification commands** after review changes and record exact passing evidence.
- [ ] **Step 5: Commit as `fix(adapter): enforce session lifecycle ownership`, push `codex/issue-6-deterministic-lifecycle`, and create a non-draft PR** with summary, verification evidence, and `Closes #6`.
