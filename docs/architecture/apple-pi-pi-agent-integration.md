# Apple Pi and Pi Agent integration

> Current baseline: Apple Pi `0.1.0`, `@earendil-works/pi-coding-agent`
> `0.84.2`, Apple Pi Protocol v1, Node `>=22.22.1`, Electron `39.8.2`.

Apple Pi is an Electron desktop host for Pi Agent, not a separate agent runtime.
The renderer talks through a sandboxed preload API to Electron main. Main
supervises a separate Node `agent-host`, which exchanges newline-delimited JSON
using Apple Pi's runtime-validated protocol. `packages/pi-adapter` is the only
package that imports the Pi SDK.

```text
React renderer -> preload -> Electron main -> agent-host -> pi-adapter -> Pi SDK
                                      |                         |
                               Protocol v1                 Pi JSONL/auth
```

## Current ownership boundary

Apple Pi owns workspace selection, desktop UI state, its catalog, process
supervision, protocol schemas, capabilities, and projections displayed by the
renderer. Pi owns the agent loop, tools, provider authentication, model runtime,
and authoritative JSONL transcript.

The current host handshake reports exact Apple Pi host, Pi, and protocol versions
plus the required `sessionEvents` and `modelSelection` capabilities. Desktop main
rejects a missing capability or any version other than the exact supported
combination before business commands are accepted. Host commands, results,
errors, and events are runtime validated at the boundary.

The adapter currently maps Pi messages, tool activity, events, models, and session
summaries into Apple Pi-owned domain types. It creates, opens, lists, replaces,
aborts, and disposes sessions with deterministic ownership. Pi JSONL remains the
source of truth and the compatibility gate proves recovery from the retained v3
fixture produced for the Pi `0.84.2` baseline.

## Current user-facing behavior

- Workspace selection, session create/list/open, prompt streaming, cancellation,
  transcript recovery, model listing, per-session model switching, and an
  app-catalog default model are implemented.
- Skill browsing, install, enable/disable, and remove are implemented in the
  Settings panel. Install/enable/disable/remove act only on the standard
  `~/.pi/agent/skills/` (user scope) and project `.pi/skills/` roots Pi's own
  `DefaultResourceLoader` already scans, so a skill installed or removed through
  Apple Pi is immediately visible to (and manageable by) the Pi CLI, and vice
  versa. The Skills settings panel currently shows an empty catalog until a
  workspace is open, even for user-scope skills that have nothing to do with any
  project; making user-scope skills visible with no workspace open is tracked
  separately (issue #68) and is not yet fixed.
- Apple Pi reuses Pi's provider configuration under `~/.pi/agent`. There is no
  native login UI; users authenticate through the Pi CLI with `/login` first.
- Signing, notarization, automatic updates, integrated terminal, Git worktree/diff
  workflows, attachments, orchestration, and productized extension management
  beyond skills remain planned. They are not covered by the current compatibility
  claim.

## Upgrade boundary

An upstream SDK change stays inside `packages/pi-adapter` when it can preserve the
existing Apple Pi protocol semantics. A breaking wire-contract change requires a
new protocol version or a safely negotiated capability. Pi upgrades are exact,
fixture-backed changes and must follow the [Pi upgrade runbook](../operations/pi-upgrade-runbook.md)
and update the [compatibility matrix](../operations/pi-compatibility-matrix.md).

For the broader desktop design and future direction, see
[Pi desktop architecture](./pi-desktop-architecture.md). Treat its proposed
components as design direction unless this page or executable code identifies
them as current behavior.
