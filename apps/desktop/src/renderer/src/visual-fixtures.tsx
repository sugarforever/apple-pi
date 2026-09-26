import React, { useEffect } from "react";
import type { ModelItem, ProviderItem, ProviderOperationResult, SkillItem, SkillOperationResult, SkillScope } from "@apple-pi/protocol";
import { CircleDashed } from "lucide-react";
import type { SessionState } from "../session-state.js";
import { toTimelineItems } from "../tool-activity.js";
import { ConversationView } from "./conversation.js";
import { ProviderSettings, type ProviderSettingsProps } from "./provider-settings.js";
import { SkillSettings, type SkillSettingsProps } from "./skill-settings.js";
import "./visual-fixtures.css";

type FixtureFeature = "conversation" | "providers" | "user-skills" | "workspace-skills";
type FixtureState = "success" | "loading" | "empty" | "failure" | "long-content" | "focus" | "unavailable";

interface VisualFixtureDefinition {
  id: string;
  feature: FixtureFeature;
  states: FixtureState[];
}

const fixtureDefinitions: VisualFixtureDefinition[] = [
  { id: "conversation/success-long-focus", feature: "conversation", states: ["success", "long-content", "focus"] },
  { id: "conversation/loading", feature: "conversation", states: ["loading"] },
  { id: "conversation/failure-unavailable", feature: "conversation", states: ["failure", "unavailable"] },
  { id: "providers/success-focus", feature: "providers", states: ["success", "focus"] },
  { id: "providers/loading", feature: "providers", states: ["loading"] },
  { id: "providers/empty", feature: "providers", states: ["empty"] },
  { id: "providers/failure", feature: "providers", states: ["failure"] },
  { id: "user-skills/success-focus", feature: "user-skills", states: ["success", "focus"] },
  { id: "user-skills/loading", feature: "user-skills", states: ["loading"] },
  { id: "user-skills/empty", feature: "user-skills", states: ["empty"] },
  { id: "user-skills/failure", feature: "user-skills", states: ["failure"] },
  { id: "workspace-skills/success-focus", feature: "workspace-skills", states: ["success", "focus"] },
  { id: "workspace-skills/loading", feature: "workspace-skills", states: ["loading"] },
  { id: "workspace-skills/empty", feature: "workspace-skills", states: ["empty"] },
  { id: "workspace-skills/failure", feature: "workspace-skills", states: ["failure"] },
];

const models: ModelItem[] = [
  { provider: "anthropic", modelId: "claude-sonnet-4", name: "Claude Sonnet 4" },
  { provider: "openai", modelId: "gpt-5", name: "GPT-5" },
];

type OpenedSessionState = SessionState & { opened: true };

const sessionBase: OpenedSessionState = {
  opened: true,
  sessionId: "fixture-session",
  sessionFile: "/Users/fixture/Library/Application Support/Apple Pi/sessions/fixture.jsonl",
  messages: [],
  running: false,
  model: models[0],
  lastSequence: 6,
  sync: { status: "synced", generation: 0 },
};

const conversationSuccess: OpenedSessionState = {
  ...sessionBase,
  messages: [
    { role: "user", content: [{ type: "text", text: "Summarize the renderer architecture and call out the next safe extraction." }] },
    {
      role: "assistant",
      content: [
        {
          type: "tool_call",
          id: "read-1",
          name: "read_file",
          arguments: { path: "/workspace/apps/desktop/src/renderer/src/a-very-long-feature-path-that-must-never-expand-the-page.tsx" },
        },
        {
          type: "text",
          text: "The renderer already keeps orchestration in `main.tsx` and presents focused regions through narrow props. The next safe extraction is the session header because it has a clear visual boundary and no persistence responsibility.\n\nLong content remains readable: `packages/protocol/src/a-deliberately-long-module-name-that-tests-wrapping-without-clipping.ts`.",
        },
      ],
    },
    {
      role: "tool",
      content: [{ type: "tool_result", toolCallId: "read-1", name: "read_file", output: [{ type: "text", text: "Read 214 lines." }], isError: false }],
    },
  ],
};

const noopResult = async (): Promise<ProviderOperationResult> => ({ diagnostics: [] });
const providerProps = (providers: ProviderItem[]): ProviderSettingsProps => ({
  providers,
  models,
  defaultModel: models[0],
  customProviders: [],
  onConnect: async () => noopResult(),
  onDisconnect: async () => noopResult(),
  onVerify: async () => noopResult(),
  onRefresh: async () => undefined,
  onDefaultModel: async () => undefined,
  onAddCustomProvider: async () => noopResult(),
  onUpdateCustomProvider: async () => noopResult(),
  onRemoveCustomProvider: async () => noopResult(),
  oauth: {
    start: () => ({ operationId: "fixture-oauth", result: noopResult() }),
    respond: async () => ({ accepted: true }),
    cancel: async () => undefined,
    subscribe: () => () => undefined,
  },
});

const connectedProviders: ProviderItem[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    authMethods: ["api_key"],
    status: "connected",
    credentialSource: "environment",
    availableModelCount: 1,
    diagnostics: [],
  },
  {
    id: "openai",
    name: "OpenAI",
    authMethods: ["api_key", "oauth"],
    status: "disconnected",
    credentialSource: "unavailable",
    availableModelCount: 1,
    diagnostics: [],
  },
];

const failedProviders: ProviderItem[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    authMethods: ["api_key"],
    status: "error",
    credentialSource: "unavailable",
    availableModelCount: 0,
    diagnostics: [
      { code: "authentication_failed", severity: "error", message: "The saved credential was rejected. Reconnect this provider.", action: "reconnect" },
    ],
  },
];

const skillResult = async (): Promise<SkillOperationResult> => ({ diagnostics: [] });
const skillsFor = (scope: SkillScope): SkillItem[] => [
  {
    name: "release-notes",
    description: "Draft concise release notes from the current branch and linked issue context.",
    scope,
    path: `/fixture/${scope}/release-notes`,
    disableModelInvocation: false,
    managed: true,
  },
  {
    name: "long-context-audit",
    description: "Inspect unusually long renderer content and report wrapping, scrolling, and accessibility risks without truncating the underlying evidence.",
    scope,
    path: `/fixture/${scope}/a-very-long-directory-name/long-context-audit`,
    disableModelInvocation: true,
    managed: true,
  },
];

const skillProps = (scope: SkillScope, skills: SkillItem[], failure = false): SkillSettingsProps => ({
  scope,
  title: scope === "user" ? "User Skills" : "Workspace Skills",
  description: scope === "user" ? "Available across all workspaces." : "Available only in apple-pi.",
  skills,
  disabledSkills: [],
  diagnostics: failure ? [{ type: "error", message: "One skill could not be loaded.", path: `/fixture/${scope}/broken-skill/SKILL.md` }] : [],
  onInstall: async () => skillResult(),
  onSetEnabled: async () => skillResult(),
  onRemove: async () => skillResult(),
  onPickDirectory: async () => null,
});

function LoadingFixture({ label }: { label: string }) {
  return (
    <section className="fixture-loading" aria-busy="true" aria-live="polite">
      <CircleDashed size={18} aria-hidden="true" />
      <div>
        <h2>{label}</h2>
        <p>Loading deterministic fixture data…</p>
      </div>
    </section>
  );
}

function FixtureSidebar({ feature }: { feature: FixtureFeature }) {
  return (
    <aside className="fixture-sidebar" aria-label="Fixture navigation">
      <div className="brand">
        <span className="brand-mark">π</span> Apple Pi
      </div>
      <p>VISUAL QA</p>
      <strong>{feature.replace("-", " ")}</strong>
      <span>apple-pi</span>
    </aside>
  );
}

function ConversationFixture({ definition }: { definition: VisualFixtureDefinition }) {
  const loading = definition.states.includes("loading");
  const failure = definition.states.includes("failure");
  const state: OpenedSessionState = loading
    ? {
        ...conversationSuccess,
        running: true,
        messages: [
          ...conversationSuccess.messages,
          { role: "assistant", content: [{ type: "tool_call", id: "running-1", name: "bash", arguments: { command: "pnpm test" } }] },
        ],
      }
    : failure
      ? { ...conversationSuccess, error: "The agent host disconnected while streaming. Your transcript is safe." }
      : conversationSuccess;
  return (
    <main>
      <header>
        <div className="header-title">
          <span className="header-context">apple-pi</span>
          <span className="header-separator">/</span>
          <strong>Editorial desktop foundation</strong>
        </div>
      </header>
      <ConversationView
        state={state}
        timelineItems={toTimelineItems(state.messages)}
        activeModelUnavailable={definition.states.includes("unavailable")}
        draft="Review the semantic token mapping"
        draftSessionId="fixture-session"
        models={
          new Map([
            ["anthropic", [models[0]!]],
            ["openai", [models[1]!]],
          ])
        }
        onDraftChange={() => undefined}
        onOpenWorkspace={() => undefined}
        onModelChange={() => undefined}
        onSend={() => undefined}
      />
    </main>
  );
}

function SettingsFixture({ definition }: { definition: VisualFixtureDefinition }) {
  const loading = definition.states.includes("loading");
  const empty = definition.states.includes("empty");
  const failure = definition.states.includes("failure");
  const scope: SkillScope = definition.feature === "workspace-skills" ? "project" : "user";
  return (
    <main>
      <header>
        <div className="header-title">
          <span className="header-context">apple-pi</span>
          <span className="header-separator">/</span>
          <strong>
            {definition.feature === "providers" ? "Settings · Providers" : definition.feature === "user-skills" ? "Settings · User Skills" : "Workspace Skills"}
          </strong>
        </div>
      </header>
      <div className="settings fixture-settings">
        {loading ? (
          <LoadingFixture label={definition.feature === "providers" ? "Models & Providers" : scope === "user" ? "User Skills" : "Workspace Skills"} />
        ) : definition.feature === "providers" ? (
          <ProviderSettings {...providerProps(empty ? [] : failure ? failedProviders : connectedProviders)} />
        ) : (
          <SkillSettings {...skillProps(scope, empty ? [] : skillsFor(scope), failure)} />
        )}
      </div>
    </main>
  );
}

export function VisualFixtureApp({ fixtureId }: { fixtureId: string }) {
  const definition = fixtureDefinitions.find((fixture) => fixture.id === fixtureId) ?? fixtureDefinitions[0]!;
  useEffect(() => {
    // Mark ready only after focus lands so captures never race the focus state.
    const frame = requestAnimationFrame(() => {
      if (definition.states.includes("focus")) document.querySelector<HTMLElement>("input, button, textarea, select")?.focus();
      document.documentElement.dataset.visualFixtureReady = definition.id;
    });
    return () => {
      cancelAnimationFrame(frame);
      delete document.documentElement.dataset.visualFixtureReady;
    };
  }, [definition]);
  return (
    <div className="fixture-shell" data-fixture-id={definition.id}>
      <FixtureSidebar feature={definition.feature} />
      {definition.feature === "conversation" ? <ConversationFixture definition={definition} /> : <SettingsFixture definition={definition} />}
    </div>
  );
}
