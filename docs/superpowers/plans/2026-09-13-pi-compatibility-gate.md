# Pi Compatibility Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pi SDK, event-shape, mapper, and persisted JSONL drift fail a repeatable compatibility command and required CI job before dependency upgrades merge.

**Architecture:** Keep sanitized Pi 0.84.2 inputs and hand-checked Apple Pi projections under the adapter test boundary. Replay those fixtures through the real mappers, exercise the installed package's public `SessionManager` and `createAgentSession` APIs in temporary directories, and compose the resulting checks into one frozen-lockfile CI gate.

**Tech Stack:** TypeScript 5.9, Vitest 4, pnpm 10, `@earendil-works/pi-coding-agent` 0.84.2, GitHub Actions.

**Spec:** GitHub Issue #7, “Add Pi compatibility fixtures and CI gate”.

## Global Constraints

- Fixtures identify Pi version `0.84.2` and contain no credentials, real prompts, user paths, or secrets.
- Runtime persistence checks use temporary directories and deterministic fake model metadata.
- The compatibility command must fail on incompatible fixture or mapper drift.
- CI uses `pnpm install --frozen-lockfile` and runs protocol, adapter compatibility, typecheck, build, and host smoke checks.
- No intentionally failing mutation remains in the final branch.

---

### Task 1: Sanitized Compatibility Corpus and Mapper Replay

**Files:**
- Create: `packages/pi-adapter/test/fixtures/pi-0.84.2/manifest.json`
- Create: `packages/pi-adapter/test/fixtures/pi-0.84.2/mapper-cases.json`
- Create: `packages/pi-adapter/test/fixtures/pi-0.84.2/legacy-session-v3.jsonl`
- Create: `packages/pi-adapter/src/compatibility.test.ts`

**Interfaces:**
- Consumes: `mapPiEvent`, `mapPiMessages`, `mapPiModel`, `mapPiSessionItem`, `PI_VERSION`.
- Produces: a fixture replay suite with literal expected Apple Pi domain values.

- [ ] **Step 1: Write the failing fixture replay test**

  Add a test that loads the versioned manifest and cases, requires `manifest.piVersion === PI_VERSION`, and deep-compares every mapper result with literal expected JSON.

- [ ] **Step 2: Run the focused test to verify RED**

  Run `pnpm --filter @apple-pi/pi-adapter exec vitest run src/compatibility.test.ts`; expect failure because the fixture corpus is absent.

- [ ] **Step 3: Add the minimal sanitized fixtures**

  Record create/open/list-compatible session metadata, user/assistant text and thinking, tool call/result, cancellation, model-switch metadata, and the corresponding Apple Pi projections. Use only `/workspace/project`, synthetic text, fixed IDs, and fixed timestamps.

- [ ] **Step 4: Run the focused test to verify GREEN**

  Run `pnpm --filter @apple-pi/protocol build && pnpm --filter @apple-pi/pi-adapter exec vitest run src/compatibility.test.ts`; expect all replay cases to pass.

### Task 2: Public Pi SDK and Legacy JSONL Compatibility

**Files:**
- Modify: `packages/pi-adapter/src/compatibility.test.ts`

**Interfaces:**
- Consumes: Pi's public `SessionManager`, `createAgentSession`, the JSONL fixture, and Node temporary-directory APIs.
- Produces: runtime checks for public SDK methods and persisted-session semantics.

- [ ] **Step 1: Write failing public SDK and restore tests**

  Add tests that call `SessionManager.create/open/list`, verify `createAgentSession` exposes subscribe/abort/setModel/dispose with a deterministic fake model, and restore the legacy JSONL fixture to assert session identity, projected messages, model selection, and active leaf/path.

- [ ] **Step 2: Run the focused test to verify RED**

  Run the compatibility test before adding the JSONL fixture or complete assertions; expect the missing restore behavior to fail.

- [ ] **Step 3: Add the minimal JSONL fixture and test harness**

  Copy the fixture into a per-test temporary directory, keep all writes there, and use fixed synthetic entries whose final leaf selects the intended branch.

- [ ] **Step 4: Run the focused test to verify GREEN**

  Run the focused Vitest command; expect create/open/list, cancellation surface, model switching, and legacy restore checks to pass.

### Task 3: Compatibility Script and Frozen-Lockfile CI Gate

**Files:**
- Modify: `package.json`
- Modify: `apps/agent-host/package.json`
- Create: `.github/workflows/pi-compatibility.yml`

**Interfaces:**
- Consumes: workspace build/test scripts and the packaged host smoke test.
- Produces: `pnpm test:pi-compatibility` and a CI job with ordered install/build/test checks.

- [ ] **Step 1: Establish the failing command contract**

  Run `pnpm test:pi-compatibility`; expect pnpm to fail because the script does not exist.

- [ ] **Step 2: Add the minimal scripts and workflow**

  Make the root compatibility script build protocol then run only adapter compatibility tests. Add a host smoke script that builds required packages and executes the real packaged host test. Configure Actions checkout, Node 22.19.0, pnpm 10.25.0, frozen install, protocol test, compatibility test, typecheck, build, and host smoke.

- [ ] **Step 3: Verify the command and mutation sensitivity**

  Run the command successfully, temporarily alter one copied fixture expectation or mapper output, rerun and capture the expected failure, restore the mutation, then rerun successfully.

- [ ] **Step 4: Verify the complete gate locally**

  Run frozen install, protocol test, compatibility test, typecheck, build, host smoke, YAML parse/static inspection, `git diff --check`, and a fixture secret/path scan.

### Task 4: Review and Delivery

**Files:**
- Review all files changed since `origin/main`.

**Interfaces:**
- Consumes: completed implementation and verification evidence.
- Produces: reviewed commit and non-draft PR closing Issue #7.

- [ ] **Step 1: Request an independent code review**

  Provide the reviewer Issue #7 requirements and the `origin/main...HEAD` diff; fix all Critical and Important findings.

- [ ] **Step 2: Run final verification from a clean state**

  Re-run the complete gate and inspect `git status`, diff, and fixture contents.

- [ ] **Step 3: Commit and push**

  Commit on `codex/issue-7-pi-compatibility` and push the branch to `origin`.

- [ ] **Step 4: Create the pull request**

  Open a non-draft PR containing a summary, exact verification evidence, and `Closes #7`; do not merge it.
