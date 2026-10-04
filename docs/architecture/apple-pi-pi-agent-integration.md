# Apple Pi and Pi: the RPC thin client

> Baseline: `@earendil-works/pi-coding-agent` `1.0.0`, Electron `39.8.2`, Node `>=22.22.1`.

Apple Pi is a graphical client for Pi, not a second agent runtime. Electron main
runs one `pi --mode rpc` child process per open session and passes Pi's own RPC
commands, responses, and events between that child and the renderer unchanged.

```text
React renderer  (transcript, composer, extension UI, sidebar, settings)
   │  window.applePi: workspaces · sessions · pi · shell
preload  (contextBridge, no logic)
   │  IPC: workspaces:*, sessions:list, pi:open/send/respondUI/close, pi:event, shell:*
Electron main
   ├─ pi-ipc.ts        validates the sender and payload shape, forwards the rest
   ├─ PiProcessPool    one child per session, cap of 6, idle LRU eviction, stopAll on quit
   ├─ shell-env.ts     login-shell environment for the children (macOS/Linux)
   └─ app-catalog.ts   the list of workspaces Apple Pi remembers
   │  JSON lines over stdio
pi --mode rpc  ×N   (Electron's Node via ELECTRON_RUN_AS_NODE, bundled rpc-entry)
```

## Who owns what

| Apple Pi | Pi |
| --- | --- |
| Windows, menus, title bar, the workspace list | Sessions and their JSONL files |
| Rendering events into a transcript | The agent loop, tools, compaction |
| Composer, model and thinking pickers (via RPC) | Models, providers, credentials (`/login`, `auth.json`) |
| Extension UI dialogs, status, widgets | Extensions, skills, prompt templates, packages |
| Process lifecycle and the shell environment | `settings.json` and the `pi` CLI |

Sessions are listed by reading Pi's session files with Pi's exported
`SessionManager`; main never runs an agent loop itself.

## Rules

- **Never redeclare Pi types.** Import them from `@earendil-works/pi-coding-agent`
  (type-only in the renderer, see `renderer/src/pi/types.ts`). The preload
  contract in `shared/pi-api.ts` only adds what Apple Pi itself owns: workspaces
  and session keys.
- **Render unknowns generically.** An unknown event, message role, content
  block, or extension UI method gets a generic block or a cancel response, never
  a crash or a hang.
- **No Apple Pi resource logic.** Skills, extensions, packages, providers, and
  settings stay in Pi. The app offers "Open settings.json" and "Open terminal
  here" and points to `pi config`, `pi install`, and `/login`.

## Environment

An app opened from Finder, the Dock, or a Linux launcher does not inherit the
login shell's environment, so keys exported in `~/.zshrc` would be invisible to
Pi. `shell-env.ts` runs `$SHELL -ilc` once at startup, prints the environment as
JSON with Electron's Node, and merges it over `process.env` for every Pi child. On
failure or after 5 seconds it falls back to `process.env`. Windows is skipped.

## Upgrading Pi

1. Bump the exact version of `@earendil-works/pi-coding-agent` in
   `apps/desktop/package.json` and run `corepack pnpm install`.
2. Read Pi's changelog for RPC, event, and extension UI changes.
3. `corepack pnpm typecheck`: Pi's types flow end to end, so a changed command or
   event shows up here.
4. `corepack pnpm test`: the transcript and extension UI reducer tests are typed
   against Pi's events; add a case for any new event or UI method worth more
   than the generic fallback.
5. Smoke test one real session in the built app: open, prompt, a tool call, and
   quit with no `pi` processes left behind.
