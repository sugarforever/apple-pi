# Apple Pi

An experimental Electron desktop client for the [pi coding agent](https://github.com/earendil-works/pi).

## Try it

Requirements: Node.js 22.19 or newer and Corepack.

```bash
corepack pnpm install
corepack pnpm dev
```

Click **Open workspace**, choose a project, and send a prompt. Apple Pi uses your existing pi provider configuration in `~/.pi/agent`. If pi is not authenticated yet, run `pi` in a terminal and use `/login` first.

The most recent pi session for a selected workspace is reopened automatically. Session transcripts remain in pi's normal JSONL storage and are compatible with the pi CLI.

## Verify and package

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm package:mac
```

The unpacked application is written below `apps/desktop/release/`.

## Current scope

This walking skeleton includes a sandboxed renderer, isolated pi agent-host process, workspace selection, streaming session updates, cancellation, and transcript recovery. Integrated terminal, Git diff/worktrees, model settings, attachments, orchestration, signing, and automatic updates are planned next.

See [the architecture study](docs/architecture/pi-desktop-architecture.md) for the full design.
