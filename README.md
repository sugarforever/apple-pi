# Apple Pi

An experimental Electron desktop client for the [pi coding agent](https://github.com/earendil-works/pi).

## Try it

Requirements: Node.js 22.20 or newer and Corepack.

```bash
corepack pnpm install
corepack pnpm dev
```

Click **Open workspace**, choose a project, and send a prompt. Apple Pi uses your existing pi provider configuration in `~/.pi/agent`. If pi is not authenticated yet, run `pi` in a terminal and use `/login` first.

The most recent pi session for a selected workspace is reopened automatically. Session transcripts remain in pi's normal JSONL storage and are compatible with the pi CLI.

## Verify and package

```bash
corepack pnpm test
corepack pnpm test:pi-compatibility
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:host-smoke
corepack pnpm package:mac
corepack pnpm package:win
corepack pnpm package:linux
```

Run only the package command native to the current operating system. macOS builds
DMG and ZIP packages for the runner's architecture, Windows builds x64 NSIS and
portable executables, and Linux builds x64 AppImage and DEB packages. Local
outputs are written below `apps/desktop/release/` with names such as
`apple-pi-0.1.0-mac-arm64.dmg`.

The [Package desktop workflow](.github/workflows/package-desktop.yml) can be run
manually from the Actions tab. Pull requests that change packaging inputs also
build on native macOS arm64, macOS x64, Windows x64, and Linux x64 runners without
publishing a release. Each Actions artifact has a deterministic
`apple-pi-<version>-<os>-<arch>` name, contains the native installers or archives,
and includes a `.sha256` sidecar for every file. Pushing a `v*` tag creates or
updates the corresponding GitHub Release only after every native build succeeds.
Verify a downloaded sidecar from the directory containing its package, for
example with `shasum -a 256 -c <package>.sha256` on macOS/Linux or
`Get-FileHash -Algorithm SHA256 <package>` on Windows.

CI packages are intentionally unsigned and require no repository secrets. macOS
Gatekeeper and Windows SmartScreen can therefore warn or block on first launch;
these builds are intended for evaluation until release signing is added. Future
release hardening requires Apple Developer ID signing plus notarization
credentials and a trusted Windows code-signing certificate. Those credentials
are not configured or represented by placeholder secrets in this workflow.

## Pi compatibility

Apple Pi currently supports the exact Pi SDK version negotiated during agent-host
startup. See the [compatibility matrix](docs/operations/pi-compatibility-matrix.md)
for the supported Apple Pi/Pi/Protocol/Node combination. Dependency upgrades must
follow the [Pi upgrade runbook](docs/operations/pi-upgrade-runbook.md).

## Current scope

This walking skeleton includes a sandboxed renderer, isolated pi agent-host process, workspace selection, streaming session updates, cancellation, transcript recovery, and model selection/defaults. Integrated terminal, Git diff/worktrees, attachments, orchestration, signing, and automatic updates are planned next.

See [how Apple Pi integrates Pi Agent](docs/architecture/apple-pi-pi-agent-integration.md)
for the current boundary and [the architecture study](docs/architecture/pi-desktop-architecture.md)
for the broader design.
