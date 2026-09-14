# macOS Signing and Notarization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce Developer ID-signed and Apple-notarized macOS release artifacts without exposing signing credentials to pull-request or manual builds.

**Architecture:** Keep ordinary CI packaging unsigned. On `v*` tag builds only, decode the App Store Connect private key into the runner's temporary directory, let electron-builder sign and notarize both macOS architectures, verify the resulting application, then publish artifacts only after the package matrix succeeds.

**Tech Stack:** GitHub Actions, Node.js 22, electron-builder 26, Apple Developer ID, App Store Connect API keys.

**Spec:** The repository secrets configured by the maintainer and the existing package/release workflow define the integration boundary.

## Global Constraints

- Never print, persist, or upload signing credentials.
- Only `v*` tag jobs may receive signing and notarization secrets.
- Pull requests must test and build without producing native installers; `workflow_dispatch` package builds remain unsigned.
- Both Apple Silicon and Intel release artifacts must be signed, notarized, and validated before release publication.

---

### Task 1: Prepare the App Store Connect key safely

- [x] Add failing tests for base64 decoding, private-key validation, file permissions, GitHub output, and invalid input.
- [x] Implement a small Node.js credential preparation script that writes only to `RUNNER_TEMP` with mode `0600`.
- [x] Run the focused test and confirm it passes.

### Task 2: Configure hardened runtime and signed packaging

- [x] Add minimal parent and child-process macOS entitlements.
- [x] Remove the forced null signing identity and enable hardened runtime.
- [x] Add a dedicated signed/notarized macOS package command while preserving the unsigned command.

### Task 3: Restrict signing to release tags

- [x] Keep unsigned packaging for manual runs and use a build-only check for pull requests.
- [x] Add tag-only credential preparation and signed macOS package steps.
- [x] Verify the signed app with `codesign`, Gatekeeper, and `stapler` before artifact collection.
- [x] Delete the temporary API key in an always-running cleanup step.

### Task 4: Document and verify the release path

- [x] Update the README with the required secret names and signed-release behavior.
- [x] Run desktop tests, typecheck, workflow linting where available, and an unsigned macOS package smoke test.
- [x] Review the diff for secret leakage and request independent code review.
- [x] Commit, push, open a pull request, and monitor its checks.
