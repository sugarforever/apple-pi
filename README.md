# Apple Pi

An experimental Electron desktop client for the [pi coding agent](https://github.com/earendil-works/pi).

## Getting started

Requirements:

- Node.js 22.22.1 or newer
- Corepack with pnpm 10.25.0
- An authenticated [pi coding agent](https://github.com/earendil-works/pi)

```bash
corepack pnpm install
corepack pnpm dev
```

Apple Pi uses the existing pi provider configuration in `~/.pi/agent`. If pi is
not authenticated, run `pi` in a terminal and use `/login` first. In Apple Pi,
click **Open workspace**, choose a project, and send a prompt.

The most recent session for a selected workspace is reopened automatically.
Transcripts remain in pi's normal JSONL storage and are compatible with the pi
CLI.

Skills work the same way: Apple Pi's Settings panel browses, installs,
enables/disables, and removes skills from the same directories the pi CLI
already scans — `~/.pi/agent/skills/` and `~/.agents/skills/` (global), and
`.pi/skills/` and `.agents/skills/` (project) — so a skill added through either
one shows up in the other with no extra step. Disabling a skill moves it into a
sibling `skills-disabled/` directory next to the root it lives in (for example
`~/.agents/skills-disabled/`), and enabling it moves it back.

## Development

This is a pnpm workspace with four main components:

- `apps/desktop`: Electron main, preload, and React renderer
- `apps/agent-host`: isolated process that owns the pi SDK session
- `packages/protocol`: validated messages shared across process boundaries
- `packages/pi-adapter`: the pinned pi SDK integration

Run commands from the repository root. `corepack pnpm dev` builds the shared
packages and agent host before starting Electron with hot reload. When changing
the process boundary, update the protocol first, then its producer and consumer.

Before opening a pull request, run:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:pi-compatibility
corepack pnpm build
corepack pnpm test:host-smoke
corepack pnpm docs:check
```

`corepack pnpm verify` runs the lint, typecheck, unit test, and documentation gates in
one command. `test:host-smoke` builds the desktop output, starts the staged agent host,
checks the compatibility handshake, and shuts it down. Pull requests also run the
[Pi compatibility workflow](.github/workflows/pi-compatibility.yml).

### Code style and commits

ESLint and Prettier define the style. Both run automatically on staged files through a
husky pre-commit hook, so the usual loop is to commit and let the hook fix what it can.

```bash
corepack pnpm lint
corepack pnpm lint:fix
corepack pnpm format
corepack pnpm format:check
```

`pnpm format:check` is part of `pnpm verify`, so the tree is expected to be clean; run
`pnpm format` before committing if the hook could not. `docs/` and `CHANGELOG.md` are excluded
from formatting because the documents under `docs/` are historical records, and reformatting
them obscures review of what they actually say.

Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org/) and
are enforced by commitlint, for example `fix(desktop): reject IPC from unknown frames`.

## Packaging

Run only the command for the current operating system:

```bash
corepack pnpm package:mac
corepack pnpm package:win
corepack pnpm package:linux
```

| Platform | Architecture                      | Outputs                      |
| -------- | --------------------------------- | ---------------------------- |
| macOS    | Current runner (`arm64` or `x64`) | DMG, ZIP                     |
| Windows  | `x64`                             | NSIS installer, portable EXE |
| Linux    | `x64`                             | AppImage, DEB                |

Local packages are written to `apps/desktop/release/`. Push a `v*` tag to run the
[Package desktop workflow](.github/workflows/package-desktop.yml), which uploads
each successful native build directly to a draft GitHub Release with deterministic
version/OS/architecture names and a `.sha256` sidecar for every download. The
release is published only after every platform build succeeds.

Verify a downloaded sidecar from the directory containing its package, for
example with `shasum -a 256 -c <package>.sha256` on macOS/Linux or
`Get-FileHash -Algorithm SHA256 <package>` on Windows.

Pull requests run unit tests, typechecking, an Electron build, and a packaged-host
smoke test on Linux; they do not create native installers. Local packages are
unsigned and require no repository secrets. macOS Gatekeeper and Windows
SmartScreen may therefore warn or block those builds on first launch.

macOS packages produced from a `v*` tag are signed with Developer ID, submitted
to Apple's notarization service, stapled, and verified before the draft GitHub
Release is published. Configure these Actions repository secrets before
publishing a tag:

- `MAC_CSC_LINK`: base64-encoded Developer ID Application `.p12`
- `MAC_CSC_KEY_PASSWORD`: password used when exporting the `.p12`
- `APPLE_API_KEY_P8`: base64-encoded App Store Connect team API `.p8`
- `APPLE_API_KEY_ID`: App Store Connect API key ID
- `APPLE_API_ISSUER`: App Store Connect issuer ID
- `APPLE_TEAM_ID`: Apple Developer team ID

The workflow exposes these secrets only to macOS jobs triggered by a tag. The
temporary `.p8` is removed after packaging. Windows release artifacts remain
unsigned until a trusted Windows code-signing certificate is configured.

## Architecture and compatibility

Apple Pi currently supports the exact Pi SDK version negotiated during agent-host
startup. See the [compatibility matrix](docs/operations/pi-compatibility-matrix.md)
for the supported Apple Pi/Pi/Protocol/Node combination. Dependency upgrades must
follow the [Pi upgrade runbook](docs/operations/pi-upgrade-runbook.md), and release failures
are covered by the [release runbook](docs/operations/release-runbook.md).

See [how Apple Pi integrates Pi Agent](docs/architecture/apple-pi-pi-agent-integration.md)
for the process boundary, [the architecture study](docs/architecture/pi-desktop-architecture.md)
for the broader design, and the [credential storage and keychain policy](docs/architecture/credential-storage-keychain-policy.md)
before touching anything that reads or writes provider credentials.
