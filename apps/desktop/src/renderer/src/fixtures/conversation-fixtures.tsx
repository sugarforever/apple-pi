import React, { useEffect, useMemo } from "react";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { ConversationLayout } from "../app/conversation.js";
import { Composer, type ComposerProps } from "../composer/composer.js";
import { ModelPicker } from "../composer/model-picker.js";
import type { Model, SlashCommand, ThinkingLevel } from "../pi/types.js";
import { initialTranscript, isRunning, type TranscriptState } from "../transcript/reducer.js";
import { Sidebar } from "../sidebar/sidebar.js";
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

const researchTurn = [
  user("This project has a big code base on top of the agent. I feel it slows down the desktop app development. Maybe that's not needed at all.", s(0)),
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

const workspaces = [
  { path: "/demo/orchard", name: "orchard" },
  { path: "/demo/pi-extensions", name: "pi-extensions" },
  { path: "/demo/recording-demo", name: "recording-demo" },
  { path: "/demo/notes", name: "notes" },
];

const session = (name: string, index: number): SessionInfo => ({
  path: `/demo/sessions/${index}.jsonl`,
  id: `session-${index}`,
  cwd: "/demo/orchard",
  name,
  created: new Date(t0),
  modified: new Date(t0),
  messageCount: 4,
  firstMessage: name,
  allMessagesText: name,
});

const sessions = [session("Thin client architecture", 1), session("Plan the RPC rebuild", 2), session("Sync main branch", 3)];

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

interface FixtureDefinition {
  state(): TranscriptState;
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
  "composer/model-menu": {
    state: finishedState,
    async prepare() {
      await click(".model-chip");
      await waitFor(".model-menu .composer-menu-item");
    },
  },
};

async function waitFor(selector: string): Promise<void> {
  while (!document.querySelector(selector)) await nextFrame();
}

export function ConversationFixture({ id }: { id: string }) {
  const fixture = fixtures[id];
  const state = useMemo(() => fixture?.state(), [fixture]);
  useEffect(() => {
    if (!fixture) return;
    void (fixture.prepare?.() ?? Promise.resolve()).then(nextFrame).then(() => (document.documentElement.dataset.visualFixtureReady = id));
  }, [fixture, id]);
  if (!state) return <p>Unknown fixture: {id}</p>;
  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        workspace={workspaces[0]!.path}
        sessions={sessions}
        activeSessionFile={sessions[0]!.path}
        onNewChat={() => undefined}
        onAddWorkspace={() => undefined}
        onSelectWorkspace={() => undefined}
        onSelectSession={() => undefined}
      />
      <ConversationLayout
        state={state}
        workspaceName="orchard"
        composer={
          <Composer
            running={isRunning(state)}
            queue={state.queue}
            loadCommands={() => Promise.resolve(commands)}
            onSend={() => undefined}
            onStop={() => undefined}
            onClearQueue={() => Promise.resolve([])}
            controls={
              <ModelPicker
                model={models[2]}
                thinkingLevel="low"
                load={() => Promise.resolve({ models, levels })}
                onSelectModel={() => undefined}
                onSelectThinking={() => undefined}
              />
            }
            {...fixture?.composer}
          />
        }
      />
    </div>
  );
}
