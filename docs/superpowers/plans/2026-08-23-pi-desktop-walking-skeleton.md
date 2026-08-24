# Pi Desktop Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a packaged Electron walking skeleton that runs one real pi agent session in an isolated child process and restores its JSONL transcript after restart.

**Architecture:** A sandboxed React renderer calls a narrow preload API; Electron main authorizes calls and communicates with a supervised Node agent-host over LF-delimited JSON. Pi remains the transcript owner, while SQLite stores only app metadata.

**Tech Stack:** TypeScript 5.9, pnpm, Electron, electron-vite, React, TypeBox, Vitest, Playwright, `@earendil-works/pi-coding-agent`

**Spec:** `docs/architecture/pi-desktop-architecture.md`

## Global Constraints

- Renderer must use `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- Pin the selected pi version exactly; do not use `^` or `~`.
- Pi JSONL is authoritative for transcript content; SQLite must not store message bodies.
- Only `packages/pi-adapter` and `apps/agent-host` may import `@earendil-works/pi-coding-agent`.
- All cross-process messages require runtime schema validation and `protocolVersion: 1`.
- Initial platform is macOS Apple Silicon; other platforms are not release blockers for this milestone.

---

### Task 1: Monorepo and secure Electron shell

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- Create: `apps/desktop/package.json`, `apps/desktop/electron.vite.config.ts`
- Create: `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/index.html`, `apps/desktop/src/renderer/main.tsx`, `apps/desktop/src/renderer/App.tsx`
- Test: `apps/desktop/tests/window-security.spec.ts`

**Interfaces:**
- Produces: a BrowserWindow with the required security flags and `window.applePi.system.getVersion(): Promise<string>`.

- [ ] Write a Playwright Electron test that launches the built app, asserts `process` and `require` are absent in renderer global scope, and calls `window.applePi.system.getVersion()`.
- [ ] Run the test and verify it fails because no app exists.
- [ ] Add workspace manifests, TypeScript configs, electron-vite build, secure BrowserWindow settings, and a preload exposing only `system.getVersion`.
- [ ] Add production navigation guards that deny new windows and open only parsed `https:` URLs externally.
- [ ] Run typecheck, build, and the Electron security test; verify all pass.
- [ ] Commit with `feat: scaffold secure Electron shell`.

### Task 2: Versioned protocol package

**Files:**
- Create: `packages/protocol/package.json`, `packages/protocol/src/index.ts`
- Create: `packages/protocol/src/envelope.ts`, `packages/protocol/src/system.ts`, `packages/protocol/src/session.ts`
- Test: `packages/protocol/src/protocol.test.ts`

**Interfaces:**
- Produces: `PROTOCOL_VERSION = 1`, `CommandEnvelope`, `ResponseEnvelope`, `EventEnvelope`, `system.hello`, `session.create`, `session.send`, `session.cancel`, and `session.snapshot` schemas.

- [ ] Write tests proving valid envelopes decode and unknown versions, command types, extra privileged fields, and malformed payloads fail.
- [ ] Run tests and verify they fail because schemas are absent.
- [ ] Implement TypeBox schemas with `additionalProperties: false` at every object boundary and export inferred static types.
- [ ] Add a discriminated decoder returning structured `INVALID_MESSAGE` and `UNSUPPORTED_PROTOCOL` errors.
- [ ] Run protocol tests and typecheck; verify all pass.
- [ ] Commit with `feat: define desktop agent protocol`.

### Task 3: Agent-host lifecycle and transport

**Files:**
- Create: `apps/agent-host/package.json`, `apps/agent-host/src/index.ts`
- Create: `apps/agent-host/src/jsonl-transport.ts`, `apps/agent-host/src/server.ts`
- Create: `apps/desktop/src/main/agent-host-supervisor.ts`
- Test: `apps/agent-host/src/server.test.ts`, `apps/desktop/tests/agent-host-recovery.spec.ts`

**Interfaces:**
- Consumes: protocol schemas from Task 2.
- Produces: `AgentHostSupervisor.start()`, `.request(command)`, `.subscribe(listener)`, `.stop()`, heartbeat events, and one automatic restart after an unexpected exit.

- [ ] Write transport tests for chunked records, multiple records per chunk, invalid JSON, and LF-only framing.
- [ ] Write a supervisor test that kills the fake host, observes `disconnected`, and verifies one restart reaches `ready`.
- [ ] Run tests and verify they fail.
- [ ] Implement a bounded JSONL parser, request correlation, 5-second heartbeat, 15-second timeout, graceful shutdown, and capped diagnostic stderr capture.
- [ ] Package the host entry point as an Electron extra resource and resolve development/production paths explicitly.
- [ ] Run unit, recovery, build, and packaged resource tests; verify all pass.
- [ ] Commit with `feat: supervise isolated agent host`.

### Task 4: Pi adapter and one-session runtime

**Files:**
- Create: `packages/pi-adapter/package.json`, `packages/pi-adapter/src/index.ts`
- Create: `packages/pi-adapter/src/pi-session-service.ts`, `packages/pi-adapter/src/transcript.ts`
- Modify: `apps/agent-host/src/server.ts`
- Test: `packages/pi-adapter/src/pi-session-service.integration.test.ts`

**Interfaces:**
- Produces: `PiSessionService.create({ cwd })`, `.send({ sessionId, text })`, `.cancel({ sessionId })`, `.snapshot({ sessionId })`, `.close()`; emits ordered `session.event` records.

- [ ] Pin the current pi package version exactly and write an integration test using a temporary Git repository and a deterministic test model/runtime injection.
- [ ] Assert a created session has a JSONL path, streamed events have increasing sequence numbers, cancellation is idempotent, and snapshot reload reads persisted transcript entries.
- [ ] Run the test and verify it fails.
- [ ] Implement the adapter around `createAgentSessionRuntime`, containing every pi-specific type inside this package.
- [ ] Translate pi events into protocol-owned normalized message, tool, usage, status, and error payloads; preserve unknown pi event kinds as diagnostic records rather than crashing.
- [ ] Run adapter tests twice: once from a fresh session and once reopening its JSONL; verify all pass.
- [ ] Commit with `feat: adapt pi sessions to host protocol`.

### Task 5: Main-process authorization and preload API

**Files:**
- Create: `apps/desktop/src/main/ipc-router.ts`, `apps/desktop/src/main/window-registry.ts`
- Create: `apps/desktop/src/preload/api.ts`, `apps/desktop/src/renderer/global.d.ts`
- Modify: `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`
- Test: `apps/desktop/tests/ipc-authorization.spec.ts`

**Interfaces:**
- Produces: `window.applePi.workspace.pick()`, `session.create()`, `session.send()`, `session.cancel()`, `session.getSnapshot()`, and `session.subscribe()`.

- [ ] Write tests that accept a canonical selected workspace but reject traversal, symlink escape, unknown window, malformed payload, and workspace ID/path mismatch.
- [ ] Run tests and verify they fail.
- [ ] Implement opaque workspace IDs in main, canonical path resolution, per-webContents authorization, runtime validation, and cleanup on window destruction.
- [ ] Expose semantic preload methods without generic `invoke`, filesystem, shell, or environment access.
- [ ] Run authorization, security, and type tests; verify all pass.
- [ ] Commit with `feat: add authorized desktop capability API`.

### Task 6: Minimal session UI and restart recovery

**Files:**
- Create: `apps/desktop/src/renderer/features/session/session-store.ts`
- Create: `apps/desktop/src/renderer/features/session/SessionView.tsx`
- Create: `apps/desktop/src/renderer/features/session/Composer.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Test: `apps/desktop/src/renderer/features/session/session-store.test.ts`
- Test: `apps/desktop/tests/live-session.spec.ts`, `apps/desktop/tests/restart-recovery.spec.ts`

**Interfaces:**
- Consumes: preload session API from Task 5.
- Produces: workspace picker, transcript timeline, composer, streaming run indicator, cancel control, and interrupted-run state.

- [ ] Write reducer tests for ordered events, duplicates, sequence gaps, reconnect snapshot replacement, streaming completion, and interruption.
- [ ] Run reducer tests and verify they fail.
- [ ] Implement a normalized session projection and UI; keep only ephemeral state in React.
- [ ] Write a live E2E test that picks a fixture workspace, sends one prompt, observes streaming and completion, and records the session ID.
- [ ] Write a restart E2E test that relaunches the app and verifies the same completed transcript is loaded from pi JSONL.
- [ ] Run unit, live, restart, security, typecheck, and build tests; verify all pass.
- [ ] Commit with `feat: deliver recoverable pi session workflow`.

### Task 7: Packaged smoke test and release evidence

**Files:**
- Create: `apps/desktop/electron-builder.yml`
- Create: `apps/desktop/tests/packaged-smoke.spec.ts`
- Create: `scripts/verify-package.mjs`
- Create: `docs/development.md`
- Modify: root `package.json`

**Interfaces:**
- Produces: `pnpm package:mac`, `pnpm test:packaged`, and a verifiable unpacked application containing the renderer, preload, main, agent-host, exact pi runtime, and required native modules.

- [ ] Write package verification that fails if agent-host, pi package metadata, native dependencies, license files, or protocol version metadata are missing.
- [ ] Run verification against the unbuilt repository and verify it fails.
- [ ] Configure hardened runtime, entitlements, asar unpack rules only for required executables/native modules, app metadata, and artifact naming.
- [ ] Add a packaged Playwright test for launch, one deterministic session turn, quit, relaunch, transcript recovery, and external-navigation denial.
- [ ] Document exact Node/pnpm prerequisites, development commands, diagnostics location, and the three test lanes.
- [ ] Run clean install, typecheck, unit tests, Electron tests, package verification, and packaged smoke; verify all pass.
- [ ] Commit with `build: package and verify walking skeleton`.

## Final verification

- [ ] Delete generated build output, install from the lockfile, and run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:packaged`.
- [ ] Confirm no transcript bodies or provider secrets appear in SQLite, logs, or Playwright artifacts.
- [ ] Kill agent-host during a run and confirm the UI reports interruption, restarts the host once, and reloads the last durable JSONL state.
- [ ] Inspect the packaged BrowserWindow flags and confirm renderer Node globals remain unavailable.
- [ ] Record exact command output and artifact path in the release checklist.
