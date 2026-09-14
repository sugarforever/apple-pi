# Apple Pi

An experimental Electron desktop client for the [pi coding agent](https://github.com/earendil-works/pi).

## Getting started

Requirements:

- Node.js 22.20 or newer
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
corepack pnpm test
corepack pnpm test:pi-compatibility
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:host-smoke
corepack pnpm docs:check
```

`test:host-smoke` builds the desktop output, starts the staged agent host, checks
the compatibility handshake, and shuts it down. Pull requests also run the
[Pi compatibility workflow](.github/workflows/pi-compatibility.yml).

## Packaging

Run only the command for the current operating system:

```bash
corepack pnpm package:mac
corepack pnpm package:win
corepack pnpm package:linux
```

| Platform | Architecture | Outputs |
| --- | --- | --- |
| macOS | Current runner (`arm64` or `x64`) | DMG, ZIP |
| Windows | `x64` | NSIS installer, portable EXE |
| Linux | `x64` | AppImage, DEB |

Local packages are written to `apps/desktop/release/`. CI packages are available
from the [Package desktop workflow](.github/workflows/package-desktop.yml) with
deterministic version/OS/architecture names and a `.sha256` sidecar for every
download. Run that workflow manually from the Actions tab, or push a `v*` tag to
attach all successful native builds to the corresponding GitHub Release.

Verify a downloaded sidecar from the directory containing its package, for
example with `shasum -a 256 -c <package>.sha256` on macOS/Linux or
`Get-FileHash -Algorithm SHA256 <package>` on Windows.

CI packages are unsigned and require no repository secrets. macOS Gatekeeper and
Windows SmartScreen may therefore warn or block on first launch. Production
distribution will require Apple signing/notarization and a trusted Windows
code-signing certificate.

## Architecture and compatibility

Apple Pi currently supports the exact Pi SDK version negotiated during agent-host
startup. See the [compatibility matrix](docs/operations/pi-compatibility-matrix.md)
for the supported Apple Pi/Pi/Protocol/Node combination. Dependency upgrades must
follow the [Pi upgrade runbook](docs/operations/pi-upgrade-runbook.md).

See [how Apple Pi integrates Pi Agent](docs/architecture/apple-pi-pi-agent-integration.md)
for the process boundary and [the architecture study](docs/architecture/pi-desktop-architecture.md)
for the broader design.
