import React, { useEffect, useMemo, useReducer } from "react";
import { flushSync } from "react-dom";
import { Folder, Settings } from "lucide-react";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { ConversationLayout } from "../app/conversation.js";
import { Composer, type ComposerProps } from "../composer/composer.js";
import { ModelPicker } from "../composer/model-picker.js";
import { initialExtensionUI, type DialogRequest, type ExtensionUIState } from "../extension-ui/reducer.js";
import type { Model, SessionStats, SlashCommand, ThinkingLevel } from "../pi/types.js";
import { SettingsView } from "../settings/settings-view.js";
import { ConversationMenu } from "../shell/conversation-menu.js";
import { IconRail } from "../shell/icon-rail.js";
import { Shell } from "../shell/shell.js";
import { TitleBar } from "../shell/title-bar.js";
import type { ChatIndicator } from "../sidebar/activity.js";
import { loadHighlighter } from "../transcript/highlight.js";
import { initialTranscript, isRunning, reduceTranscript, type TranscriptAction, type TranscriptState } from "../transcript/reducer.js";
import { Sidebar } from "../sidebar/sidebar.js";
import { longSession } from "./long-session.js";
import { assistant, text, thinking, toolCall, toolResult, user } from "./sample-messages.js";

/*
 * Static pages for visual review (`pnpm fixtures:generate`). Each renders the
 * real components from invented session data.
 */

const t0 = Date.UTC(2026, 9, 2, 9, 0, 0);
const s = (seconds: number) => t0 + seconds * 1000;

const answer = `I agree with the direction: the desktop app is rebuilding too much of what Pi already does.

The right product is not a second agent runtime with a window around it. It is a **thin graphical client** for Pi.

### Recommendation

Keep the desktop app focused on the experience and let Pi own the agent. Reduce it to:

\`\`\`
React renderer
    ↕ narrow Electron IPC
Electron main
    ↕ JSON lines over stdio
pi --mode rpc
    ├── sessions and transcript
    ├── agent loop and tools
    └── models and thinking
\`\`\`

What stays in the app:

1. Windows, menus, and the project list.
2. Rendering the event stream — \`message_update\`, \`tool_execution_end\` — as a readable transcript.
3. Opening \`settings.json\` and a terminal in the project.

Everything else moves behind \`pi\` so upgrades land without app changes.`;

const ls = toolCall("call-ls", "bash", { command: "ls -la apps/desktop/src && git status --short" });
const read = toolCall("call-read", "read", { path: "/Users/demo/projects/orchard/apps/desktop/src/main/agent-host-supervisor.ts" });
const grep = toolCall("call-grep", "grep", { pattern: "registerSkill", path: "packages" });
const bash2 = toolCall("call-test", "bash", { command: "pnpm --filter @orchard/desktop test -- --reporter dot" });
const search = toolCall("call-find", "find", { pattern: "**/*.d.ts", path: "node_modules/@pi/agent/dist" });
const edit = toolCall("call-edit", "edit", { path: "apps/desktop/src/renderer/src/transcript/reducer.ts", edits: [] });

const researchPrompt =
  "This project has a big code base on top of the agent. I feel it slows down the desktop app development. Maybe that's not needed at all.";

const researchTurn = [
  user(researchPrompt, s(0)),
  assistant(
    [
      thinking("Compare the app's own protocol layer with what the RPC mode already offers."),
      text(
        "I'm going to trace both codebases and the current PR state, then compare a thin client architecture against continuing the desktop app as it is. This is an architecture decision with several interacting parts, so I'll map them before recommending anything.",
      ),
      ls,
    ],
    s(4),
    "toolUse",
  ),
  toolResult(
    ls,
    "total 48\ndrwxr-xr-x  12 demo  staff   384 Oct  2 09:00 main\ndrwxr-xr-x   6 demo  staff   192 Oct  2 09:00 renderer\n?? docs/research/",
    s(6),
  ),
  assistant(
    [
      text(
        "The first important clue is already visible: `orchard` has several untracked architecture plans, so I'll treat them as your work and won't modify them. Now I'm mapping the integration surfaces in `agent-core` — session, event stream, RPC — and matching them to what the app duplicates.",
      ),
      read,
      grep,
      bash2,
    ],
    s(30),
    "toolUse",
  ),
  toolResult(read, "export class AgentHostSupervisor {\n  // …\n}", s(32)),
  toolResult(grep, "packages/adapter/src/skills.ts:14: export function registerSkill(", s(33)),
  toolResult(bash2, "....................\n42 passed", s(70)),
  assistant([text("The current release changes the answer: it ships a typed RPC client and richer commands."), search, edit], s(200), "toolUse"),
  toolResult(search, "rpc-types.d.ts\njson-event.d.ts", s(210)),
  toolResult(edit, "Edited 1 file", s(220)),
  assistant([text(answer)], s(386)),
];

const finishedState = (): TranscriptState => ({
  ...initialTranscript,
  messages: [
    user("What does the desktop app do on start-up?", s(-600)),
    assistant([text("It restores the last project, starts one agent process per open session, and replays the session file into the transcript.")], s(-592)),
    ...researchTurn,
  ],
  runs: [],
});

const runningState = (): TranscriptState => {
  const now = Date.now();
  const check = toolCall("call-check", "bash", { command: "pnpm typecheck" });
  const live = toolCall("call-live", "bash", { command: "pnpm --filter @orchard/desktop test" });
  return {
    ...initialTranscript,
    messages: [
      ...researchTurn,
      user("Go ahead and remove the legacy host, then run the checks.", now - 12_000),
      assistant([text("Removing the legacy host package and its scripts first."), check], now - 10_000, "toolUse"),
      toolResult(check, "Done in 4.1s", now - 6_000),
    ],
    streaming: assistant([text("Typecheck passes. Running the desktop tests next."), live], now - 5_000, "pending"),
    tools: { [live.id]: { status: "running", output: "RUN  v4.0.18" } },
    runs: [{ messageIndex: researchTurn.length, startedAt: now - 12_000 }],
  };
};

// Pi's display diff for an edit: sign, padded line number, text, and `...` between hunks.
const retryDiff = [
  "    ...",
  " 18 export async function withRetry<T>(run: () => Promise<T>, options: RetryOptions = {}): Promise<T> {",
  "-19   const attempts = options.attempts ?? 3;",
  "+19   const { attempts = 3, signal } = options;",
  "+20   let delay = options.initialDelayMs ?? 250;",
  " 21   for (let attempt = 1; ; attempt++) {",
  " 22     try {",
  " 23       return await run();",
  " 24     } catch (error) {",
  "-25       if (attempt >= attempts) throw error;",
  "-26       await sleep(250 * attempt);",
  "+25       if (attempt >= attempts || signal?.aborted || !isRetryable(error)) throw error;",
  "+26       await sleep(jitter(delay), signal);",
  "+27       delay = Math.min(delay * 2, MAX_DELAY_MS);",
  " 28     }",
  " 29   }",
  " 30 }",
  "    ...",
  " 41 /** Network failures and 5xx responses; a 4xx will fail the same way again. */",
  "-42 const isRetryable = (error: unknown) => error instanceof NetworkError;",
  "+42 const isRetryable = (error: unknown): boolean =>",
  "+43   error instanceof NetworkError || (error instanceof HttpError && error.status >= 500);",
  "    ...",
].join("\n");

const backoffFile = `/**
 * Exponential backoff with full jitter, shared by every retrying caller.
 * Delays double from the initial value up to MAX_DELAY_MS.
 */
export const MAX_DELAY_MS = 8_000;

export interface RetryOptions {
  /** Total tries, including the first. */
  attempts?: number;
  initialDelayMs?: number;
  signal?: AbortSignal;
}

export class NetworkError extends Error {
  readonly name = "NetworkError";
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** A random delay between zero and \`ms\`, so clients that failed together retry apart. */
export const jitter = (ms: number): number => Math.round(Math.random() * ms);

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
`;

const toolResultsAnswer = `Retries now back off exponentially with jitter, stop early on an aborted signal, and give up at once on 4xx responses.

\`\`\`ts
const data = await withRetry(() => fetchIndex(url), { attempts: 5, signal: controller.signal });
\`\`\`

The new helpers live in \`session/backoff.ts\`. To check the change locally:

\`\`\`bash
pnpm --filter @orchard/desktop test -- retry
git diff --stat
\`\`\``;

const toolResultsState = (): TranscriptState => {
  const readRetry = toolCall("call-read-retry", "read", { path: "apps/desktop/src/renderer/src/session/retry.ts" });
  const write = toolCall("call-write", "write", { path: "apps/desktop/src/renderer/src/session/backoff.ts", content: backoffFile });
  const editRetry = toolCall("call-edit-retry", "edit", { path: "apps/desktop/src/renderer/src/session/retry.ts", edits: [] });
  const test = toolCall("call-test-retry", "bash", { command: "pnpm --filter @orchard/desktop test -- retry" });
  return {
    ...initialTranscript,
    messages: [
      user("Make the session retries back off properly and skip errors that will never succeed.", s(0)),
      assistant([text("I'll read the current retry helper first."), readRetry], s(3), "toolUse"),
      toolResult(readRetry, "import { sleep } from './sleep';\n\nexport async function withRetry<T>(run: () => Promise<T>) {\n  // …\n}", s(4)),
      assistant([text("The backoff helpers deserve their own module, then the retry loop can use them."), write, editRetry], s(40), "toolUse"),
      toolResult(write, `Successfully wrote ${backoffFile.length} bytes to apps/desktop/src/renderer/src/session/backoff.ts`, s(41)),
      {
        ...toolResult(editRetry, "Successfully replaced 3 blocks in apps/desktop/src/renderer/src/session/retry.ts.", s(42)),
        details: { diff: retryDiff, patch: "", firstChangedLine: 19 },
      },
      assistant([test], s(50), "toolUse"),
      toolResult(test, " ✓ src/session/retry.test.ts (6 tests) 18ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)", s(58)),
      assistant([text(toolResultsAnswer)], s(64)),
    ],
    runs: [],
  };
};

const workspaces = [
  { path: "/demo/amap-mcp-server", name: "amap-mcp-server" },
  { path: "/demo/pi-mono", name: "pi-mono" },
  { path: "/demo/pi-extensions", name: "pi-extensions" },
  { path: "/demo/recording-demo", name: "recording-demo" },
  { path: "/demo/notes", name: "notes" },
  { path: "/demo/hackathon-hunt", name: "hackathon-hunt" },
  { path: "/demo/orchard", name: "orchard" },
  { path: "/demo/fpl-bot", name: "fpl-bot" },
];
const project = workspaces[6]!;

const session = (title: string, index: number, named = true, parent?: number): SessionInfo => ({
  path: `/demo/sessions/${index}.jsonl`,
  parentSessionPath: parent === undefined ? undefined : `/demo/sessions/${parent}.jsonl`,
  id: `session-${index}`,
  cwd: project.path,
  name: named ? title : undefined,
  created: new Date(t0),
  modified: new Date(t0 - index * 3_600_000),
  messageCount: 4,
  firstMessage: title,
  allMessagesText: title,
});

const sessions = [
  session("Thin client architecture", 1),
  session("Remove the legacy agent host and run the checks", 2, false),
  session("Plan the RPC rebuild", 3),
  session("Sync main branch", 4),
  session("Read the review and open a PR", 5),
  session("Update the record terminal skill", 6),
  session("Draft release notes", 7),
];
// A fork of the first chat, taken from its second message, and a copy of the third.
const forkedChat = { ...session("What does the desktop app do on start-up?", 8, false, 1), modified: new Date(t0 + 600_000) };
const forkedSessions = [forkedChat, ...sessions, session("Plan the RPC rebuild", 9, true, 3)];
const indicators: Record<string, ChatIndicator> = { [sessions[1]!.path]: "running", [sessions[3]!.path]: "unread" };

const stats: SessionStats = {
  sessionFile: sessions[0]!.path,
  sessionId: "session-1",
  userMessages: 6,
  assistantMessages: 14,
  toolCalls: 23,
  toolResults: 23,
  totalMessages: 43,
  tokens: { input: 184_200, output: 12_480, cacheRead: 920_000, cacheWrite: 31_000, total: 1_147_680 },
  cost: 1.84,
  contextUsage: { tokens: 61_000, contextWindow: 200_000, percent: 30.5 },
};

const model = (provider: string, id: string, name: string, reasoning = true): Model => ({
  id,
  name,
  api: "openai-responses",
  provider,
  baseUrl: `https://${provider}.example`,
  reasoning,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 32_000,
});

const models = [
  model("anthropic", "fixture-opus", "Fixture Opus"),
  model("anthropic", "fixture-haiku", "Fixture Haiku"),
  model("openai", "fixture-sol", "Fixture Sol"),
  model("ollama", "fixture-local", "fixture-local:27b", false),
];
const levels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

const command = (name: string, description: string, source: SlashCommand["source"]): SlashCommand => ({
  name,
  description,
  source,
  sourceInfo: { path: `/demo/.pi/${name}`, source: "local", scope: "user", origin: "top-level" },
});

const commands = [
  command("review", "Review the working tree diff for correctness bugs", "extension"),
  command("fix-tests", "Fix failing tests and explain each change", "prompt"),
  command("release-notes", "Draft release notes from merged pull requests since the last tag", "prompt"),
  command("skill:diagram-to-image", "Convert Mermaid diagrams and Markdown tables to PNG images for platforms without rich formatting", "skill"),
  command("skill:handoff", "Compact the conversation into a handoff document for another agent", "skill"),
];

// A small invented screenshot: a window with a title bar and two panes.
const screenshot = btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#eef1f5"/><rect width="120" height="14" fill="#d5dbe3"/><rect x="6" y="20" width="30" height="64" rx="3" fill="#c9d3df"/><rect x="42" y="20" width="72" height="30" rx="3" fill="#ffffff"/><rect x="42" y="56" width="72" height="28" rx="3" fill="#a8c1e0"/></svg>',
);

const dialog = (request: Pick<DialogRequest, "id" | "method" | "title"> & Record<string, unknown>): ExtensionUIState["dialogs"][number] => ({
  request: { type: "extension_ui_request", ...request } as DialogRequest,
  sessionKey: "fixture",
  deadline: typeof request.timeout === "number" ? Date.now() + request.timeout : undefined,
});

/** Status and widget text as two installed extensions might set it. */
const extensionChrome: Pick<ExtensionUIState, "statuses" | "widgets"> = {
  statuses: [
    { key: "throughput", text: "↯ 84 tok/s · 12.4k out" },
    { key: "router", text: "router: fixture-sol (auto)" },
  ],
  widgets: [
    {
      key: "index",
      placement: "aboveEditor",
      lines: ["semantic index  orchard  ·  2,184 chunks  ·  updated 3m ago", "last query      “agent host supervisor”  →  6 hits in 41 ms"],
    },
  ],
};

interface FixtureDefinition {
  state(): TranscriptState;
  /** Which page fills the main view; the conversation by default. */
  page?: "settings";
  /** Opens on the new-chat prompt with no chat selected. */
  isNew?: boolean;
  /** Opens the title bar's conversation menu with these statistics. */
  menuStats?: SessionStats;
  /** Lists forks and copies in the sidebar, with this chat open. */
  forked?: SessionInfo;
  extensionUI?(): ExtensionUIState;
  composer?: Partial<ComposerProps>;
  /** Runs once the page is painted, before capture: expand rows, scroll. */
  prepare?(): Promise<void>;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Clicks every match, then waits a frame so React renders what the clicks revealed. */
async function click(selector: string): Promise<void> {
  document.querySelectorAll<HTMLElement>(selector).forEach((element) => element.click());
  await nextFrame();
}

const fixtures: Record<string, FixtureDefinition> = {
  "conversation/finished": {
    state: finishedState,
    async prepare() {
      const scroller = document.querySelector(".transcript-scroller");
      if (scroller) scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - 160;
    },
  },
  "conversation/expanded": {
    state: finishedState,
    async prepare() {
      await click(".turn:last-of-type .worked-for");
      await click(".turn:last-of-type .activity-group > .activity-row");
      await click('.turn:last-of-type .activity-item .activity-row[title^="Ran pnpm"]');
      document.querySelector(".turn:last-of-type")?.scrollIntoView();
    },
  },
  "conversation/running": { state: runningState },
  "conversation/edit-diff": {
    state: toolResultsState,
    async prepare() {
      await click(".worked-for");
      await click(".activity-group > .activity-row");
      await click('.activity-row[title^="Edited"]');
      await loadHighlighter();
      await nextFrame();
      document.querySelector('.activity-row[title^="Edited"]')?.scrollIntoView();
      document.querySelector(".transcript-scroller")?.scrollBy(0, -96);
    },
  },
  "conversation/write-file": {
    state: toolResultsState,
    async prepare() {
      await click(".worked-for");
      await click(".activity-group > .activity-row");
      await click('.activity-row[title^="Wrote"]');
      await loadHighlighter();
      await nextFrame();
      document.querySelector('.activity-row[title^="Wrote"]')?.scrollIntoView();
      document.querySelector(".transcript-scroller")?.scrollBy(0, -96);
    },
  },
  "conversation/highlighted-code": {
    state: toolResultsState,
    async prepare() {
      await loadHighlighter();
      await nextFrame();
      const scroller = document.querySelector(".transcript-scroller");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    },
  },
  "shell/conversation": {
    state: finishedState,
    async prepare() {
      const scroller = document.querySelector(".transcript-scroller");
      if (scroller) scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - 160;
    },
  },
  "shell/conversation-menu": { state: finishedState, menuStats: stats },
  "shell/forked-chat": {
    // Just forked from the second message: the history before it, and that message back in the composer.
    state: () => ({ ...finishedState(), messages: finishedState().messages.slice(0, 2) }),
    forked: forkedChat,
    composer: { initialDraft: researchPrompt },
  },
  "conversation/fork-action": {
    state: finishedState,
    async prepare() {
      // As if the pointer rested on the last message.
      const actions = document.querySelector<HTMLElement>(".turn:last-of-type .user-actions");
      if (actions) actions.style.opacity = "1";
      document.querySelector(".turn:last-of-type")?.scrollIntoView();
      document.querySelector(".transcript-scroller")?.scrollBy(0, -120);
    },
  },
  // ~1,500 messages. `window.fixtureDispatch` feeds it reducer actions, such as streaming deltas, for timing.
  "conversation/long-session": {
    state: () => ({ ...initialTranscript, messages: longSession() }),
    async prepare() {
      const scroller = document.querySelector(".transcript-scroller");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    },
  },
  "shell/new-chat": { state: () => initialTranscript, isNew: true },
  "shell/settings": { state: () => initialTranscript, page: "settings" },
  "composer/attachment": {
    state: finishedState,
    composer: {
      initialDraft: "Why does the sidebar overlap the title bar in this screenshot?",
      initialAttachments: [{ id: "shot", name: "sidebar.png", image: { type: "image", data: screenshot, mimeType: "image/svg+xml" } }],
    },
  },
  "composer/commands": {
    state: finishedState,
    composer: { initialDraft: "/" },
    prepare: () => waitFor(".command-palette"),
  },
  "composer/queued": {
    state: () => ({
      ...runningState(),
      queue: { steering: ["Skip the e2e suite, it needs a display"], followUp: ["When you're done, summarise what changed in two sentences"] },
    }),
    composer: { initialDraft: "Also run the linter" },
  },
  "extension-ui/confirm": {
    state: finishedState,
    extensionUI: () => ({
      ...initialExtensionUI,
      dialogs: [
        dialog({
          id: "confirm",
          method: "confirm",
          title: "Allow rm -rf apps/agent-host?",
          message: "The guard extension blocks recursive deletes outside the build folders. Allow this one command?",
          timeout: 29_600,
        }),
        dialog({ id: "next", method: "input", title: "Commit message" }),
      ],
    }),
  },
  "extension-ui/select": {
    state: finishedState,
    extensionUI: () => ({
      ...initialExtensionUI,
      dialogs: [
        dialog({
          id: "select",
          method: "select",
          title: "Which package should the release notes cover?",
          options: ["@orchard/desktop", "@orchard/agent", "Both packages"],
        }),
      ],
    }),
  },
  "extension-ui/editor": {
    state: finishedState,
    extensionUI: () => ({
      ...initialExtensionUI,
      dialogs: [
        dialog({
          id: "editor",
          method: "editor",
          title: "Edit the commit message",
          prefill: "refactor(desktop): drop the legacy agent host\n\nPi's RPC mode replaces the host process and its protocol package.",
        }),
      ],
    }),
  },
  "extension-ui/status-widget": {
    state: finishedState,
    extensionUI: () => ({ ...initialExtensionUI, ...extensionChrome }),
  },
  "extension-ui/notification": {
    state: finishedState,
    extensionUI: () => ({
      ...initialExtensionUI,
      ...extensionChrome,
      notices: [
        { id: "info", level: "info", message: "Index refreshed: 14 files changed" },
        { id: "warning", level: "warning", message: "guard.ts: Blocked git push --force to main" },
        { id: "error", level: "error", message: "router.ts: Provider fixture-sol returned 429; falling back to fixture-local" },
      ],
    }),
  },
  "composer/model-menu": {
    state: finishedState,
    async prepare() {
      await click(".model-chip");
      await waitFor(".model-menu .menu-item");
    },
  },
};

async function waitFor(selector: string): Promise<void> {
  while (!document.querySelector(selector)) await nextFrame();
}

export function ConversationFixture({ id }: { id: string }) {
  const fixture = fixtures[id];
  const initial = useMemo(() => fixture?.state(), [fixture]);
  const [state, dispatch] = useReducer(reduceTranscript, initial ?? initialTranscript);
  useEffect(() => {
    Object.assign(window, { fixtureState: initial, fixtureDispatch: (action: TranscriptAction) => flushSync(() => dispatch(action)) });
  }, [initial]);
  const extensionUI = useMemo(() => fixture?.extensionUI?.(), [fixture]);
  useEffect(() => {
    if (!fixture) return;
    void (fixture.prepare?.() ?? Promise.resolve()).then(nextFrame).then(() => (document.documentElement.dataset.visualFixtureReady = id));
  }, [fixture, id]);
  if (!initial) return <p>Unknown fixture: {id}</p>;
  const selected = fixture?.isNew || fixture?.page ? undefined : (fixture?.forked ?? sessions[0]!);
  const noop = () => undefined;
  const titleBar =
    fixture?.page === "settings" ? (
      <TitleBar sidebarOpen onToggleSidebar={noop} icon={<Settings size={16} />} title="Settings" />
    ) : (
      <TitleBar
        sidebarOpen
        onToggleSidebar={noop}
        icon={<Folder size={16} />}
        title={
          selected === forkedChat
            ? forkedChat.firstMessage
            : selected
              ? "This project has a big code base on top of the agent. I feel it slows down the desktop app development."
              : "New chat"
        }
        actions={
          <ConversationMenu
            workspace={project.path}
            sessionFile={selected?.path}
            duplicate={selected && (() => Promise.resolve())}
            initialStats={fixture?.menuStats}
            onError={noop}
          />
        }
      />
    );
  return (
    <Shell
      titleBar={titleBar}
      rail={<IconRail view={fixture?.page === "settings" ? "settings" : "chats"} onSelect={noop} />}
      sidebar={
        <Sidebar
          workspaces={workspaces}
          sessions={{ [project.path]: fixture?.forked ? forkedSessions : sessions }}
          expanded={new Set([project.path])}
          activeSessionFile={selected?.path}
          indicator={(file) => indicators[file]}
          onNewChat={noop}
          onAddProject={noop}
          onToggleProject={noop}
          onRemoveProject={noop}
          onSelectChat={noop}
          onRenameChat={noop}
        />
      }
    >
      {fixture?.page === "settings" ? (
        <SettingsView piVersion="1.0.0" appVersion="0.6.0" onOpenSettingsFile={noop} />
      ) : (
        <ConversationLayout
          state={state}
          workspaceName={project.name}
          isNew={fixture?.isNew}
          onFork={noop}
          extensionUI={extensionUI && { state: extensionUI, onRespond: noop, onDismissNotice: noop }}
          composer={
            <Composer
              running={isRunning(state)}
              queue={state.queue}
              loadCommands={() => Promise.resolve(commands)}
              onSend={noop}
              onStop={noop}
              onClearQueue={() => Promise.resolve([])}
              controls={
                <ModelPicker
                  model={models[2]}
                  thinkingLevel="low"
                  load={() => Promise.resolve({ models, levels })}
                  onSelectModel={noop}
                  onSelectThinking={noop}
                />
              }
              {...fixture?.composer}
            />
          }
        />
      )}
    </Shell>
  );
}
