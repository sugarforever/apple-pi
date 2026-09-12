# Agent Host Capability Handshake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent-host prove its Protocol v1, host, exact Pi, and Apple Pi feature capabilities before Electron Main sends product commands.

**Architecture:** Extend the Apple Pi-owned `system.hello` result schema and have agent-host populate it from its own package metadata and the adapter-owned Pi version. Keep Electron Main independent of Pi packages; the supervisor validates the typed handshake and refuses readiness when any required version or named capability is incompatible.

**Tech Stack:** TypeScript 5.9, TypeBox, Vitest, Electron, JSONL over stdio

**Spec:** `docs/architecture/apple-pi-pi-agent-integration.md`

## Global Constraints

- Keep Protocol v1 commands and meanings compatible.
- Only `packages/pi-adapter` may import or inspect `@earendil-works/pi-*` packages.
- Require exact non-empty host and Pi versions plus every capability used by the current desktop release.
- Report actionable compatibility errors before the supervisor becomes ready.

---

### Task 1: Specify the handshake contract

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/protocol.test.ts`
- Modify: `packages/pi-adapter/src/index.ts`

**Interfaces:**
- Produces: `HostHelloResult` through `HostCommandResults["system.hello"]` with `protocolVersion`, `hostVersion`, `piVersion`, `capabilities`, and `pid`.
- Consumes: existing `HostCapabilitiesSchema` and `PROTOCOL_VERSION`.

- [ ] **Step 1: Write failing protocol tests** that accept a complete literal handshake and reject missing versions, missing flags, extra flags, and an incompatible protocol literal.
- [ ] **Step 2: Run `pnpm --filter @apple-pi/protocol test`** and confirm the complete handshake fails because the current schema only permits protocol version and PID.
- [ ] **Step 3: Extend the closed `system.hello` result schema** with non-empty host/Pi versions and the closed named capability schema.
- [ ] **Step 4: Re-run protocol tests** and confirm all cases pass.

### Task 2: Report and enforce compatibility

**Files:**
- Modify: `apps/agent-host/src/server.ts`
- Modify: `apps/agent-host/src/server.test.ts`
- Modify: `apps/desktop/src/main/agent-host-supervisor.ts`
- Create: `apps/desktop/src/main/agent-host-supervisor.test.ts`

**Interfaces:**
- Consumes: typed `HostCommandResults["system.hello"]`, agent-host version metadata, adapter-owned exact Pi version.
- Produces: host handshake and a pure `validateHostHandshake(value)` compatibility gate used by `AgentHostSupervisor.start()`.

- [ ] **Step 1: Add failing host and supervisor tests** for the complete compatible handshake, incompatible protocol, missing Pi version, and each required capability set to false.
- [ ] **Step 2: Run focused host and desktop tests** and confirm failures are caused by the missing report and validation behavior.
- [ ] **Step 3: Add the minimal host report and supervisor validation** without importing Pi in Electron Main.
- [ ] **Step 4: Run focused tests** and confirm they pass, then run typecheck, build, the complete test suite in dependency order, and `git diff --check`.
- [ ] **Step 5: Review the final diff against Issue #3**, commit, push, and open a non-draft PR containing test evidence and `Closes #3`.
