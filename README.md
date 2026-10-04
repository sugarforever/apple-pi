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

Apple Pi is a thin graphical client: every session runs the bundled Pi in RPC
mode, so providers, credentials, skills, extensions, and settings are Pi's own.
If Pi is not authenticated, run `pi` in a terminal and use `/login` first; API
keys exported in your shell profile are picked up too. Manage skills, extensions,
and packages with `pi config` and `pi install`. In Apple Pi, add a project, start
a chat, and send a prompt.

Sessions are Pi's normal JSONL files and stay compatible with the Pi CLI.

## Development

Everything lives in `apps/desktop`: Electron main, preload, and the React
renderer. See [the RPC thin-client architecture](docs/architecture/apple-pi-pi-agent-integration.md)
for the process boundary and the rules that keep Apple Pi thin, and
[Renderer UI conventions](docs/renderer-ui-conventions.md) for tokens and layout.

Run commands from the repository root. `corepack pnpm dev` starts Electron with
hot reload. Before opening a pull request, run:

```bash
corepack pnpm verify
```

`verify` runs the version, formatting, lint, typecheck, script, unit test, and
documentation gates, including from a checkout with no generated `out` directory.
`corepack pnpm test:package` builds the app and checks the sandboxed preload bundle.
On macOS, `package:mac` consistently ad-hoc signs the local development package;
run `test:mac-package-launch` afterward for a launch smoke check.

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

After creating a local macOS package, verify that the unpacked app reaches a stable running state:

```bash
corepack pnpm test:mac-package-launch
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

Pull requests run unit tests, typechecking, and an Electron build on Linux; they
do not create native installers. Local packages are
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

Apple Pi bundles one exact Pi version. Upgrading it follows the routine in
[the architecture doc](docs/architecture/apple-pi-pi-agent-integration.md#upgrading-pi),
and release failures are covered by the [release runbook](docs/operations/release-runbook.md).
