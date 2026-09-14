# Cross-Platform Desktop Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and validate Apple Pi desktop packages natively on macOS, Windows, and Linux, publish deterministic artifacts with SHA-256 checksums, and attach them safely to `v*` GitHub Releases.

**Architecture:** A small Node staging module replaces shell-specific file operations and owns the packaged agent-host layout contract. Electron Builder receives explicit native platform targets and deterministic artifact names, while one least-privilege GitHub Actions workflow separates read-only build jobs from the tag-only release job. The packaged-host smoke test exercises the staged entry point and validates the real compatibility handshake before shutdown.

**Tech Stack:** Node.js 22.20.0, pnpm 10.25.0, TypeScript, Vitest, Electron 39, electron-builder 26, GitHub Actions.

**Spec:** [GitHub Issue #18](https://github.com/sugarforever/apple-pi/issues/18)

## Global Constraints

- Build macOS packages only on GitHub-hosted macOS runners, Windows packages only on Windows runners, and Linux packages only on Ubuntu runners.
- macOS targets arm64 and x64 and produces DMG or ZIP; Windows targets x64 and produces NSIS and/or portable; Linux targets x64 and produces AppImage and DEB.
- Ordinary CI and manual builds must not require signing or notarization secrets.
- Pull requests must use `contents: read` and must never publish a GitHub Release.
- Only a `v*` tag release job may use `contents: write`.
- Artifact names must contain the application version, operating system, and architecture, and every artifact must have a SHA-256 checksum.
- Use Node.js 22.20.0, pnpm 10.25.0, and `pnpm install --frozen-lockfile` in CI.
- Superseded branch and pull-request runs may be cancelled; tagged release builds must not be cancelled.
- The packaged agent-host entry files and runtime dependencies must be present, and the packaged entry point must complete the compatibility handshake.

---

### Task 1: Cross-platform agent-host staging

**Files:**
- Create: `apps/desktop/scripts/stage-agent-host.mjs`
- Create: `apps/desktop/scripts/stage-agent-host.test.mjs`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Consumes: agent-host compiled files in `apps/agent-host/dist`.
- Produces: `stageAgentHost({ sourceDir, destinationDir }): Promise<string[]>`, which recreates `out/agent-host` and returns the staged filenames; a CLI invocation with repository-relative defaults.

- [ ] **Step 1: Write the failing staging tests**

  Create temporary source and destination directories with `node:fs/promises`, write `index.js`, `server.js`, and `host-process.js` fixtures plus a stale destination file, call the wished-for `stageAgentHost`, and assert that the returned list and destination entries equal the three required filenames while the stale file is removed. Add a second test that omits `server.js` and asserts rejection with the missing filename.

- [ ] **Step 2: Run the tests and verify RED**

  Run: `node --test apps/desktop/scripts/stage-agent-host.test.mjs`

  Expected: FAIL because `stage-agent-host.mjs` does not exist.

- [ ] **Step 3: Implement the minimal staging module and CLI**

  Export `REQUIRED_AGENT_HOST_FILES` and `stageAgentHost`; validate every source with `stat`, remove and recreate the destination with `rm`/`mkdir`, then copy each file with `copyFile`. Detect direct CLI execution with `pathToFileURL(process.argv[1]).href === import.meta.url`, resolve defaults from the script directory, and report actionable failures through a non-zero exit.

- [ ] **Step 4: Make the desktop build use Node staging**

  Replace the POSIX `mkdir -p` and `cp` tail in `apps/desktop/package.json` with `node scripts/stage-agent-host.mjs`.

- [ ] **Step 5: Run the staging tests and desktop build and verify GREEN**

  Run: `node --test apps/desktop/scripts/stage-agent-host.test.mjs && corepack pnpm --filter @apple-pi/desktop build`

  Expected: all staging tests pass and `apps/desktop/out/agent-host` contains exactly the required host entry files.

### Task 2: Packaged-layout handshake smoke test

**Files:**
- Modify: `apps/desktop/src/main/agent-host-package.test.ts`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Consumes: `apps/desktop/out/agent-host/index.js` created by Task 1 and `validateHostHandshake(value, expectedHostVersion)`.
- Produces: a mandatory smoke test that validates files, starts the staged host, validates its decoded `system.hello` result, and shuts it down cleanly.

- [ ] **Step 1: Tighten the smoke test before changing production scripts**

  Replace conditional `it.runIf` with an unconditional test. Assert all required host files exist; send `system.hello`; pass the response result to `validateHostHandshake` with agent-host version `0.1.0`; assert protocol, host, Pi version, required capabilities, and numeric PID; then send `system.shutdown` and assert exit code zero.

- [ ] **Step 2: Verify RED against a missing staged layout**

  Run: `rm -rf apps/desktop/out/agent-host` only after confirming that exact generated directory, then run `corepack pnpm --filter @apple-pi/desktop exec vitest run src/main/agent-host-package.test.ts`.

  Expected: FAIL with the missing packaged agent-host entry path.

- [ ] **Step 3: Wire smoke preparation through the cross-platform build**

  Keep `test:package` as `pnpm build` followed by the focused Vitest test so no platform shell syntax is required.

- [ ] **Step 4: Verify GREEN**

  Run: `corepack pnpm test:host-smoke`

  Expected: the staged host reports a valid compatibility handshake and exits cleanly.

### Task 3: Native electron-builder targets and deterministic local outputs

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: staged `out/**/*`, application version `0.1.0`, electron-builder `${version}`, `${os}`, `${arch}`, and `${ext}` macros.
- Produces: `package:mac`, `package:win`, and `package:linux` scripts and artifacts named `apple-pi-${version}-${os}-${arch}.${ext}` in `apps/desktop/release`.

- [ ] **Step 1: Add platform packaging scripts**

  Configure each script to run the desktop build and then invoke electron-builder for its native OS/architecture with `--publish never`; set `CSC_IDENTITY_AUTO_DISCOVERY=false` for unsigned macOS CI.

- [ ] **Step 2: Define electron-builder targets**

  Set global `artifactName` to `apple-pi-${version}-${os}-${arch}.${ext}`. Configure macOS `dmg` and `zip` for arm64/x64 with `identity: null`, Windows `nsis` and `portable` for x64, and Linux `AppImage` and `deb` for x64 with the developer-tools category metadata.

- [ ] **Step 3: Expose root package commands**

  Add root `package:win` and `package:linux` forwarding scripts alongside `package:mac`.

- [ ] **Step 4: Validate the host platform package**

  On the current macOS host run `corepack pnpm package:mac`; otherwise run the matching native package command. Confirm filenames contain `0.1.0`, OS, and architecture and inspect the unpacked application for `out/agent-host/index.js`, `server.js`, and `host-process.js`.

### Task 4: Least-privilege native packaging workflow

**Files:**
- Create: `.github/workflows/package-desktop.yml`

**Interfaces:**
- Consumes: Task 2 smoke command, Task 3 package commands, `github.event_name`, `github.ref_type`, and uploaded build artifacts.
- Produces: native matrix validation artifacts with checksum sidecars and a tag-only GitHub Release upload.

- [ ] **Step 1: Define safe triggers, permissions, and concurrency**

  Trigger on `workflow_dispatch`, `v*` tags, and pull requests whose paths include the workflow, desktop packaging code/config, agent-host code, root package metadata, lockfile, or README. Set workflow-level `permissions: contents: read`. Use a concurrency group keyed by workflow and ref with `cancel-in-progress: ${{ !startsWith(github.ref, 'refs/tags/') }}`.

- [ ] **Step 2: Add the native build matrix**

  Use explicit matrix entries for macOS arm64/x64 on appropriate GitHub-hosted macOS runners, Windows x64 on `windows-latest`, and Linux x64 on `ubuntu-latest`. Each job checks out, installs Node 22.20.0 and pnpm 10.25.0, runs frozen install, protocol tests, Pi compatibility tests, typecheck, build, and packaged-host smoke before its native package command.

- [ ] **Step 3: Stage deterministic artifacts and checksums portably**

  Add a Node script step that reads the desktop version, selects only final installer/archive extensions for the matrix target, verifies at least one expected file, copies them into `artifacts/apple-pi-${version}-${os}-${arch}`, and writes `<filename>.sha256` files containing lowercase SHA-256 and basename. Upload that directory with an Actions artifact named `apple-pi-${version}-${os}-${arch}` and finite retention.

- [ ] **Step 4: Add a tag-only release job**

  Gate the job with `if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')`, depend on every build, grant only that job `contents: write`, download all matrix artifacts, and attach packages plus checksum files to the existing tag release with GitHub CLI. Do not let pull-request or manual runs enter this job.

- [ ] **Step 5: Validate workflow syntax and policy**

  Parse the YAML with an available YAML parser or actionlint. Inspect the resolved workflow to confirm native runners, read-only global permissions, tag-only write permission, finite retention, native package commands, and non-cancelling tags.

### Task 5: Packaging documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: root package commands and `.github/workflows/package-desktop.yml` behavior.
- Produces: accurate local/manual build, artifact, checksum, release, and unsigned-build guidance.

- [ ] **Step 1: Expand Verify and package**

  Document `test`, `test:pi-compatibility`, `typecheck`, `build`, `test:host-smoke`, and all three native package commands; state that each package command must run on its own operating system.

- [ ] **Step 2: Document GitHub Actions artifacts and releases**

  Link to the packaging workflow, explain manual dispatch and PR validation, list deterministic version/OS/arch names and `.sha256` sidecars, and explain that `v*` tags attach successful native outputs to the matching GitHub Release.

- [ ] **Step 3: Document unsigned limitations and future hardening**

  Explain macOS Gatekeeper and Windows SmartScreen warnings. List Apple Developer ID signing/notarization credentials and a Windows code-signing certificate as future hardening without adding secret names, placeholders, or credentials to CI.

- [ ] **Step 4: Check links**

  Run: `corepack pnpm docs:check`

  Expected: all local documentation links resolve.

### Task 6: Full verification, review, and Pull Request

**Files:**
- Modify only files required by issues found during verification or review.

**Interfaces:**
- Consumes: all prior tasks and Issue #18 acceptance criteria.
- Produces: a pushed `codex/` branch and a non-Draft PR closing Issue #18.

- [ ] **Step 1: Run fresh full verification**

  Run: `corepack pnpm install --frozen-lockfile && corepack pnpm test && corepack pnpm test:pi-compatibility && corepack pnpm typecheck && corepack pnpm build && corepack pnpm test:host-smoke && corepack pnpm docs:check`.

  Expected: every command exits zero with no failed tests.

- [ ] **Step 2: Run feasible native packaging verification**

  Run the package command for the current host, inspect final filenames, checksum generation behavior, and packaged agent-host files. Record which other platform packages remain delegated to their native GitHub Actions runners.

- [ ] **Step 3: Request independent code review**

  Give the reviewer the Issue #18 requirements, this plan, and the `origin/main..HEAD` diff. Fix every Critical and Important finding and rerun affected tests.

- [ ] **Step 4: Commit and push**

  Commit the plan and implementation on `codex/issue-18-cross-platform-packaging`, push it to `origin`, and verify the remote branch points at the local HEAD.

- [ ] **Step 5: Create the non-Draft Pull Request**

  Create a PR to `main` whose body contains a summary, macOS/Windows/Linux matrix, verification evidence, unsigned limitations, and the exact footer `Closes #18`. Do not merge it.

- [ ] **Step 6: Observe available PR checks**

  Watch the available checks through completion. For failures introduced by this PR, reproduce where feasible, add a failing regression test when behavior changes, fix, rerun verification, commit, push, and re-observe the checks.
