# Pi upgrade runbook

This runbook is the release gate for changing Apple Pi's pinned
`@earendil-works/pi-coding-agent` dependency. Run it in the same pull request as
the dependency change and update the [compatibility matrix](./pi-compatibility-matrix.md)
with links to the resulting evidence.

## 1. Establish the upgrade baseline

Start from an up-to-date `main` branch and record the versions being compared:

```bash
git fetch origin main
git switch -c codex/pi-<target-version>-upgrade origin/main
node -p "require('./package.json').version"
node -p "require('./packages/pi-adapter/package.json').dependencies['@earendil-works/pi-coding-agent']"
node -p "require('./apps/desktop/package.json').devDependencies.electron"
corepack pnpm --filter @apple-pi/protocol build
node --input-type=module -e "import('./packages/protocol/dist/index.js').then(({ PROTOCOL_VERSION }) => console.log(PROTOCOL_VERSION))"
node --version
```

The branch name may vary, but it must retain the repository's `codex/` prefix.
Save the old Pi version for the PR evidence and rollback decision.

## 2. Review the upstream release before changing the lockfile

Export the intended version (for example, `export PI_TARGET_VERSION=0.85.0`),
verify its package metadata, and compare every upstream release between the
pinned and target tags:

```bash
PI_PREVIOUS_VERSION=$(git show origin/main:packages/pi-adapter/package.json | node -e "let data=''; process.stdin.on('data', chunk => data += chunk).on('end', () => console.log(JSON.parse(data).dependencies['@earendil-works/pi-coding-agent']))")
PI_TARGET_VERSION=${PI_TARGET_VERSION:?Export the target Pi version first}
npm view "@earendil-works/pi-coding-agent@${PI_TARGET_VERSION}" version engines repository dist.integrity
open "https://github.com/earendil-works/pi/compare/v${PI_PREVIOUS_VERSION}...v${PI_TARGET_VERSION}"
open "https://github.com/earendil-works/pi/blob/v${PI_TARGET_VERSION}/packages/coding-agent/CHANGELOG.md"
open "https://github.com/earendil-works/pi/blob/v${PI_TARGET_VERSION}/packages/coding-agent/docs/sdk.md"
```

Review the changelog and source diff, not only the TypeScript compiler result.
Check each Apple Pi SDK touchpoint: `createAgentSession`, `AgentSession.prompt`,
`abort`, `subscribe`, `setModel`, `dispose`, `ModelRuntime`, and
`SessionManager.create/open/list`. Also inspect message/event shapes, session
format changes, default resource loading, auth storage, provider discovery, and
model lookup behavior. Record relevant upstream links in the PR.

Stop here if the target tag or package metadata cannot be independently verified.

## 3. Update the exact dependency and lockfile

Apple Pi deliberately uses an exact Pi version. Do not replace it with a semver
range.

```bash
PI_TARGET_VERSION=${PI_TARGET_VERSION:?Export the target Pi version first}
corepack pnpm --filter @apple-pi/pi-adapter add --save-exact "@earendil-works/pi-coding-agent@${PI_TARGET_VERSION}"
corepack pnpm install --frozen-lockfile
git diff -- packages/pi-adapter/package.json pnpm-lock.yaml
```

Confirm that the manifest and lockfile resolve exactly the target version and
that no unrelated dependency changed.

## 4. Update version declarations and compatibility fixtures

Update `SUPPORTED_PI_VERSION` in `packages/protocol/src/index.ts`. Copy the
previous fixture directory as the starting corpus, then rename all test labels
and fixture paths in `packages/pi-adapter/src/compatibility.test.ts`:

```bash
PI_PREVIOUS_VERSION=$(git show origin/main:packages/pi-adapter/package.json | node -e "let data=''; process.stdin.on('data', chunk => data += chunk).on('end', () => console.log(JSON.parse(data).dependencies['@earendil-works/pi-coding-agent']))")
PI_TARGET_VERSION=${PI_TARGET_VERSION:?Export the target Pi version first}
cp -R "packages/pi-adapter/test/fixtures/pi-${PI_PREVIOUS_VERSION}" "packages/pi-adapter/test/fixtures/pi-${PI_TARGET_VERSION}"
rg -n "${PI_PREVIOUS_VERSION}|pi-${PI_PREVIOUS_VERSION}" packages/protocol packages/pi-adapter apps
```

Update the new fixture `manifest.json` to the target Pi version. Refresh
`mapper-cases.json` from observed target-version structures and keep it synthetic
and deterministic. Remove credentials, user names, absolute home paths, prompts,
and proprietary tool output before committing. Never overwrite the previous
version's corpus until the upgrade has shipped; it is rollback evidence.

The corpus must continue to exercise text, thinking, tool call/result,
cancellation, model metadata, session create/open/list, and model switching.
Add cases for any new upstream shape even when the adapter intentionally ignores
it. A fixture diff is required PR evidence.

## 5. Prove old JSONL recovery

Keep `legacy-session-v3.jsonl` as a fixture created by the previously supported
Pi version. Do not resave or migrate it with the target version. The compatibility
test must open it through the target `SessionManager` and assert the stable
session ID, active leaf/branch, selected model, and Apple Pi message projection.

```bash
PI_PREVIOUS_VERSION=$(git show origin/main:packages/pi-adapter/package.json | node -e "let data=''; process.stdin.on('data', chunk => data += chunk).on('end', () => console.log(JSON.parse(data).dependencies['@earendil-works/pi-coding-agent']))")
corepack pnpm test:pi-compatibility
git diff -- "packages/pi-adapter/test/fixtures/pi-${PI_PREVIOUS_VERSION}/legacy-session-v3.jsonl"
```

The second command must be empty. If Pi requires an official migration API, add
a copied input fixture and an explicit migration test; do not let Apple Pi invent
or silently rewrite Pi-owned JSONL.

## 6. Check runtime, auth, and model behavior

Compare `npm view ... engines.node` with the root README, the CI
`node-version`, `@types/node`, and Electron's embedded Node version. The supported
Node floor is the highest floor required by Apple Pi, Pi, and build tooling. If
it rises, update all declarations and CI in the same PR. If native dependencies
or ABI requirements change, verify both the development host and the packaged
Electron host.

Use a disposable test provider/account; never paste tokens into logs or fixtures.
With an already authenticated Pi profile, run:

```bash
corepack pnpm dev
```

In the app, open a disposable workspace, confirm the authenticated provider's
models appear, create a session, send a harmless prompt, switch models, send a
second prompt, cancel a running prompt, quit, relaunch, and reopen the same
session. Confirm the selected model and transcript recover. Also confirm the
documented fallback still works: when authentication is absent, `pi` plus
`/login` establishes credentials that Apple Pi can reuse from `~/.pi/agent`.

Redact provider, model, workspace, and account identifiers from screenshots and
logs unless they are intentionally public.

## 7. Run automated and packaged release gates

Use the repository scripts exactly as CI does:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm docs:check
corepack pnpm --filter @apple-pi/protocol test
corepack pnpm test:pi-compatibility
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test
corepack pnpm test:host-smoke
corepack pnpm package:mac
git diff --check origin/main...HEAD
```

Launch the unpacked app under `apps/desktop/release/`, repeat create/send/cancel/
restore once, and confirm the packaged host starts without relying on workspace
`node_modules`. Record the OS/architecture and artifact path or CI artifact link.
Signing, notarization, and automatic updates are not currently implemented, so
this smoke does not claim to verify them.

## 8. Decide the Apple Pi protocol version

Keep Protocol v1 when upstream SDK signatures or data shapes change but the
adapter preserves every existing Apple Pi command, required field, response,
event, ordering rule, and meaning.

Introduce a new protocol version when any existing Apple Pi wire contract becomes
incompatible: a command or event is removed or reinterpreted, a required field is
added, a field's type changes, ordering semantics change, or an older desktop and
new host can no longer communicate safely. Add schemas and negotiation tests;
never silently redefine v1. New optional behavior can stay on the current version
only when capability negotiation makes absence safe.

The PR must state the decision—`Protocol v1 retained` or `Protocol vN introduced`—
and why.

## 9. Required release evidence

The upgrade PR is not ready until it contains:

- previous and target Apple Pi, Pi, Protocol, Node, pnpm, and Electron versions;
- upstream changelog, compare, SDK/API, and package-engine links reviewed;
- the dependency/lockfile diff and sanitized fixture diff;
- legacy JSONL recovery result and confirmation that the old input was unchanged;
- documentation links, compatibility, full test, typecheck, build, host smoke,
  and macOS package results;
- disposable auth/model/manual smoke result with secrets and user data redacted;
- the explicit Protocol version decision;
- an updated compatibility-matrix row linking the PR and CI run;
- known limitations and the rollback target.

## 10. Rollback conditions and procedure

Do not release—or revert to the previous supported Pi version—when any required
gate fails, old JSONL cannot be restored without data loss, mapped behavior drifts
without an intentional protocol change, required capabilities disappear, auth or
model selection regresses, the Node/Electron floor cannot be met, the packaged
host cannot start, or a release-blocking upstream regression has no contained
adapter fix.

Rollback in a new branch by restoring the previous exact dependency,
`SUPPORTED_PI_VERSION`, lockfile, and previous fixture path. Re-run every command
in section 7 and the auth/model smoke. Add a matrix row only for a released or
release-qualified combination; mark a reverted combination `Withdrawn` and link
both the failed upgrade and rollback evidence. Never delete the failed version's
evidence from Git history.
