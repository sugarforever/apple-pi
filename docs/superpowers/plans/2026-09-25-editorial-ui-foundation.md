# Editorial UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish cross-platform semantic renderer tokens and deterministic visual QA fixtures for issue #111 without changing production behavior.

**Architecture:** Keep current CSS values as the light-on-dark mapping behind explicit semantic roles. Add a fixture-only renderer entry that composes the existing conversation, Provider, User Skill, and Workspace Skill presentation modules from narrow typed data; a standalone Electron capture harness loads that entry and writes fixed-size PNG references.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Electron 39, electron-vite.

**Spec:** GitHub issues #105 and #111.

## Global Constraints

- Preserve existing renderer behavior and all current IPC/persistence ownership.
- Keep presentation props narrow and typed; fixtures, styles, and tests stay under the renderer feature boundary.
- Do not add a UI framework, state-management layer, speculative shared library, or later-epic navigation changes.
- Cover 1280×800, 960×640, and 800×600 reference sizes.
- Preserve focus visibility, reduced motion, contrast, and page-level overflow behavior.

## Review Focus

- Missing state coverage must fail the fixture contract test.
- An accidental viewport change must fail the fixture contract test.
- Fixture rendering must remain independent of `window.applePi`.
- Long content must wrap or scroll without creating page-level overflow.
- Focus and reduced-motion accommodations must remain visible in captured fixtures.

---

### Task 1: Semantic visual tokens

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles.css`
- Modify: `apps/desktop/src/renderer/ui-contract.test.ts`

**Interfaces:**
- Consumes: the existing renderer selectors and values.
- Produces: semantic surface, text, border, accent, state, typography, spacing, sizing, and focus custom properties.

- [ ] Add failing renderer contract assertions for token roles and accessibility media rules.
- [ ] Run the focused contract test and confirm the new assertions fail for missing roles.
- [ ] Add the minimal aliases and migrate literal role uses without changing rendered values.
- [ ] Re-run the focused contract test and confirm it passes.

### Task 2: Deterministic feature fixtures

**Files:**
- Create: `apps/desktop/src/renderer/src/visual-fixtures.tsx`
- Create: `apps/desktop/src/renderer/src/visual-fixtures.css`
- Create: `apps/desktop/src/renderer/visual-fixtures.json`
- Create: `apps/desktop/src/renderer/visual-fixtures.test.ts`
- Modify: `apps/desktop/src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: `ConversationView`, `ProviderSettings`, and `SkillSettings` with their existing typed props.
- Produces: a query-selected, deterministic visual fixture renderer with success, loading, empty, failure, long-content, focus, and unavailable coverage where relevant.

- [ ] Add a failing manifest/renderer contract test for feature, state, focus, and overflow coverage.
- [ ] Run the focused fixture test and confirm it fails because fixture artifacts are absent.
- [ ] Add the typed fixtures and a query-gated renderer entry that never accesses IPC.
- [ ] Re-run renderer tests and typecheck.

### Task 3: Reference capture workflow

**Files:**
- Create: `apps/desktop/scripts/capture-visual-fixtures.cjs`
- Create: `apps/desktop/scripts/generate-visual-fixtures.mjs`
- Create: `apps/desktop/scripts/generate-visual-fixtures.test.mjs`
- Modify: `apps/desktop/package.json`
- Modify: `docs/renderer-ui-conventions.md`
- Create: `apps/desktop/test/visual-fixtures/*.png`

**Interfaces:**
- Consumes: the built renderer fixture entry and JSON manifest.
- Produces: `pnpm --filter @apple-pi/desktop fixtures:generate` and deterministic PNG references at all required sizes.

- [ ] Add failing script tests for the capture plan, filenames, and dimensions.
- [ ] Run the script test and confirm failure because the generator is absent.
- [ ] Implement the Electron capture harness and document generation/review.
- [ ] Generate all reference PNGs and verify dimensions and expected file count.
- [ ] Run desktop tests, root typecheck/build/format check, fixture generation, and diff checks.
