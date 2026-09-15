# Development Tooling and Main-Process Hardening Implementation Plan

**Goal:** Give the repository a lint, formatting, and commit-hygiene baseline that CI can enforce, and harden the Electron main process with structured logging, an explicit security policy, and unit tests for the rules that cannot be observed from a test runner.

**Architecture:** Keep policy decisions as pure functions in `apps/desktop/src/shared/security-policy.ts` and wire them to Electron in `apps/desktop/src/main/security.ts`. Tests assert the pure functions and the renderer's Content Security Policy. Logging goes through `apps/desktop/src/main/logger.ts`, which redacts credentials before any sink is written.

**Tech Stack:** ESLint 10 flat config, typescript-eslint 8, Prettier 3, husky 9, lint-staged 17, commitlint 21, vitest 4.

**Spec:** This plan and the existing package and CI workflows define the integration boundary.

## Global Constraints

- Never disable the operating system keychain. See the [credential storage and keychain policy](../../architecture/credential-storage-keychain-policy.md).
- Do not duplicate packaging, signing, or release work that already exists in `.github/workflows/package-desktop.yml`.
- Prettier is adopted incrementally: only files touched by a change are reformatted, so reviewers never see a repository-wide reformat mixed into a behavioural change.
- `pnpm lint` must exit zero on the unmodified tree, so a rule that cannot be satisfied without an unrelated refactor is recorded as a warning instead of silently dropped.
- No credential may reach a log sink, including host stderr and provider error messages.

---

### Task 1: Establish the lint and formatting baseline

- [x] Add `.editorconfig`, `.npmrc`, `.nvmrc`, `.prettierrc.json`, `.prettierignore`, and `eslint.config.js`.
- [x] Enable `@eslint/js`, `typescript-eslint` recommended, and the React Hooks rules for the renderer only.
- [x] Verify `pnpm lint` exits zero on the existing tree and fix the genuine findings it reports.
- [x] Keep the pre-existing `react-hooks/set-state-in-effect` finding as a warning; the renderer fix is a behavioural change and belongs in its own change.

### Task 2: Enforce commit and pre-commit hygiene

- [x] Add `commitlint` with the conventional types already used by the project's history.
- [x] Add husky `pre-commit` (lint-staged) and `commit-msg` (commitlint) hooks.
- [x] Configure lint-staged to run `eslint --fix` and `prettier --write` on staged source files.

### Task 3: Structured, redacting logging

- [x] Implement `logger.ts` with secret-shaped key redaction, credential-pattern redaction, bounded depth, and a rotating file sink under `app.getPath("logs")`.
- [x] Test redaction, nesting, circular metadata, failing sinks, file output, and rotation.
- [x] Route agent-host stderr through the logger instead of `console.error`.

### Task 4: Main-process security policy

- [x] Extract the Content Security Policy, external-protocol allowlist, and navigation policy into `shared/security-policy.ts` as pure functions.
- [x] Tighten the renderer CSP and add a test asserting the document and the constant cannot drift.
- [x] Deny all permission, device-permission, and permission-check requests on the default session.
- [x] Block `<webview>` attachment and deny popup creation by default.
- [x] Reject IPC calls from an unexpected or destroyed `webContents`, or from a subframe.
- [x] Start the crash reporter with local-only dumps.

### Task 5: Verify and document

- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm docs:check`.
- [x] Document the new commands in the README.
- [x] Record the keychain constraint in the [credential storage and keychain policy](../../architecture/credential-storage-keychain-policy.md).

## Deferred

- **Automatic updates.** `electron-updater` needs an `app-update.yml`, which electron-builder
  only emits when a publish provider is configured, and the release workflow currently
  uploads a curated artifact set. Shipping the runtime without that feed produces an
  updater that can never find an update, so it belongs in a change that also updates the
  release workflow and can be verified by a real tagged build.
- **Reformatting the existing tree.** A dedicated, no-behaviour-change commit should run
  `pnpm format` once, after which `format:check` can join `pnpm verify`.
- **Renderer update UI** for the `react-hooks/set-state-in-effect` warning.
