import { describe, expect, it } from "vitest";
import {
  decodeApplePiMessage,
  decodeApplePiContentPart,
  decodeApplePiSessionEvent,
  decodeCustomProviderDefinition,
  decodeHostCapabilities,
  decodeModelItem,
  decodeProviderAuthEvent,
  decodeSessionItem,
  decodeSessionSnapshot,
  decodeSkillCatalog,
  decodeSkillItem,
} from "./domain.js";

describe("Apple Pi domain decoders", () => {
  it("decodes a closed session snapshot", () => {
    const snapshot = {
      opened: true,
      sessionId: "session-1",
      sessionFile: "/tmp/session.jsonl",
      messages: [
        { role: "user", content: [{ type: "text", text: "Inspect the project" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "I will inspect it." },
            { type: "tool_call", id: "call-1", name: "read", arguments: { path: "README.md" } },
            { type: "text", text: "The project is ready." },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool_result", toolCallId: "call-1", name: "read", output: [{ type: "text", text: "# Apple Pi" }], isError: false }],
        },
      ],
      running: false,
      model: { provider: "openai", modelId: "gpt-5", name: "GPT-5" },
    };

    expect(decodeSessionSnapshot(snapshot)).toEqual(snapshot);
  });

  it("decodes session, model, and capability fixtures", () => {
    const session = {
      id: "session-1",
      path: "/tmp/session.jsonl",
      name: "First",
      created: "2026-09-12T10:00:00.000Z",
      modified: "2026-09-12T10:01:00.000Z",
      messageCount: 3,
    };
    const model = { provider: "openai", modelId: "gpt-5", name: "GPT-5" };
    const capabilities = {
      sessionEvents: true,
      modelSelection: true,
      providerManagement: true,
      cancellableProviderOperations: true,
      skillManagement: true,
    };

    expect(decodeSessionItem(session)).toEqual(session);
    expect(decodeModelItem(model)).toEqual(model);
    expect(decodeHostCapabilities(capabilities)).toEqual(capabilities);
  });

  it.each([
    { type: "text_delta", text: "Hello" },
    { type: "thinking_delta", text: "Reasoning" },
    { type: "tool_call", phase: "started", id: "call-1", name: "bash", arguments: { command: "pwd" } },
    { type: "tool_result", id: "call-1", name: "bash", output: [{ type: "text", text: "/tmp" }], isError: false },
    { type: "lifecycle", phase: "started" },
    { type: "resync_required", reason: "unsupported Pi event" },
  ])("decodes the $type event fixture", (event) => {
    expect(decodeApplePiSessionEvent(event)).toEqual(event);
  });

  it("rejects extra fields and Pi-specific fields", () => {
    expect(() => decodeSessionItem({ id: "s", path: "/s", name: "S", created: "now", modified: "now", messageCount: 0, branch: "main" })).toThrow(
      "Invalid session item",
    );
    expect(() => decodeApplePiMessage({ role: "assistant", content: [{ type: "text", text: "ok", piMetadata: true }] })).toThrow("Invalid Apple Pi message");
  });

  it("rejects missing discriminators and invalid values", () => {
    expect(() => decodeApplePiSessionEvent({ messageId: "m1", text: "Hello" })).toThrow("Invalid Apple Pi session event");
    expect(() => decodeApplePiSessionEvent({ type: "lifecycle", phase: "paused" })).toThrow("Invalid Apple Pi session event");
    expect(() => decodeSessionItem({ id: "s", path: "/s", name: "S", created: "now", modified: "now", messageCount: -1 })).toThrow("Invalid session item");
    expect(() => decodeSessionItem({ id: "s", path: "/s", name: "S", created: "yesterday", modified: "2026-09-12T10:01:00.000Z", messageCount: 0 })).toThrow(
      "Invalid session item",
    );
    expect(() =>
      decodeSessionItem({ id: "s", path: "/s", name: "S", created: "2026-04-31T10:00:00.000Z", modified: "2026-09-12T10:01:00.000Z", messageCount: 0 }),
    ).toThrow("Invalid session item");
  });

  it("rejects non-serializable values", () => {
    expect(() => decodeApplePiSessionEvent({ type: "tool_call", phase: "started", id: "call-1", name: "bash", arguments: { timeout: 1n } })).toThrow(
      "Invalid Apple Pi session event",
    );
    expect(() => decodeApplePiContentPart({ type: "tool_call", id: "call-1", name: "bash", arguments: { value: new Map() } })).toThrow(
      "Invalid Apple Pi content part",
    );
    expect(() => decodeApplePiContentPart({ type: "tool_call", id: "call-1", name: "bash", arguments: { value: new Date() } })).toThrow(
      "Invalid Apple Pi content part",
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => decodeApplePiContentPart({ type: "tool_call", id: "call-1", name: "bash", arguments: cyclic })).toThrow("Invalid Apple Pi content part");

    const arrayWithMetadata = ["value"] as string[] & { piMetadata?: boolean };
    arrayWithMetadata.piMetadata = true;
    expect(() => decodeApplePiContentPart({ type: "tool_call", id: "call-1", name: "bash", arguments: { value: arrayWithMetadata } })).toThrow(
      "Invalid Apple Pi content part",
    );
  });
});

describe("provider auth events", () => {
  it.each([
    { type: "info", message: "Signed in as jane@example.com" },
    { type: "auth_url", url: "https://auth.openai.com/oauth/authorize?state=abc", instructions: "A browser window should open." },
    { type: "device_code", userCode: "ABCD-1234", verificationUri: "https://auth.openai.com/codex/device", intervalSeconds: 5, expiresInSeconds: 900 },
    { type: "progress", message: "Waiting for authentication..." },
    {
      type: "prompt",
      prompt: { type: "manual_code", promptId: "prompt-1", message: "Paste the authorization code", placeholder: "http://localhost:1455/auth/callback?..." },
    },
    { type: "prompt", prompt: { type: "select", promptId: "prompt-2", message: "Select login method", options: [{ id: "browser", label: "Browser login" }] } },
  ])("decodes the $type auth event fixture", (event) => {
    expect(decodeProviderAuthEvent(event)).toEqual(event);
  });

  it("rejects an auth event carrying an unexpected secret-shaped field", () => {
    expect(() => decodeProviderAuthEvent({ type: "auth_url", url: "https://auth.openai.com/oauth/authorize", accessToken: "sk-should-not-be-here" })).toThrow(
      "Invalid provider auth event",
    );
    expect(() => decodeProviderAuthEvent({ type: "unknown", message: "x" })).toThrow("Invalid provider auth event");
  });
});

describe("custom provider definitions", () => {
  const definition = {
    id: "my-local-llm",
    name: "My Local LLM",
    baseUrl: "https://localhost:8080/v1",
    api: "openai-completions",
    models: [{ id: "local-model-a", name: "Local Model A", reasoning: false, contextWindow: 8192, maxTokens: 2048 }],
  };

  it("decodes a well-formed custom provider definition", () => {
    expect(decodeCustomProviderDefinition(definition)).toEqual(definition);
  });

  it("decodes a definition carrying the narrow compat subset", () => {
    const withCompat = { ...definition, compat: { supportsDeveloperRole: false, maxTokensField: "max_completion_tokens" } };
    expect(decodeCustomProviderDefinition(withCompat)).toEqual(withCompat);
  });

  it("never carries a secret field", () => {
    expect(() => decodeCustomProviderDefinition({ ...definition, apiKey: "sk-should-not-be-here" })).toThrow("Invalid custom provider definition");
  });

  it("rejects an unsupported api type instead of accepting an arbitrary Pi api string", () => {
    expect(() => decodeCustomProviderDefinition({ ...definition, api: "openai-responses" })).toThrow("Invalid custom provider definition");
  });

  it("rejects an id outside the safe slug charset", () => {
    expect(() => decodeCustomProviderDefinition({ ...definition, id: "My Local LLM!" })).toThrow("Invalid custom provider definition");
  });

  it("requires at least one model", () => {
    expect(() => decodeCustomProviderDefinition({ ...definition, models: [] })).toThrow("Invalid custom provider definition");
  });

  it("rejects a non-positive contextWindow or maxTokens", () => {
    expect(() => decodeCustomProviderDefinition({ ...definition, models: [{ id: "m1", contextWindow: 0 }] })).toThrow("Invalid custom provider definition");
    expect(() => decodeCustomProviderDefinition({ ...definition, models: [{ id: "m1", maxTokens: -1 }] })).toThrow("Invalid custom provider definition");
  });
});

describe("skill catalog", () => {
  const skills = [
    {
      name: "pdf-forms",
      description: "Fill and flatten PDF forms.",
      scope: "user",
      path: "/home/jane/.pi/skills/pdf-forms/SKILL.md",
      disableModelInvocation: false,
      managed: true,
    },
    {
      name: "release-notes",
      description: "Draft release notes from recent commits.",
      scope: "project",
      path: "/repo/.pi/skills/release-notes/SKILL.md",
      disableModelInvocation: true,
      managed: false,
    },
  ];
  const diagnostics = [
    {
      type: "warning",
      message: "Skill 'legacy-helper' is missing a description and was skipped.",
      path: "/repo/.pi/skills/legacy-helper/SKILL.md",
    },
    {
      type: "collision",
      message: "Skill 'pdf-forms' is defined in two locations; the project copy wins.",
      collision: {
        resourceType: "skill",
        name: "pdf-forms",
        winnerPath: "/repo/.pi/skills/pdf-forms/SKILL.md",
        loserPath: "/home/jane/.pi/skills/pdf-forms/SKILL.md",
        winnerSource: "project",
        loserSource: "user",
      },
    },
  ];
  const catalog = { skills, diagnostics };

  it("decodes a valid skill catalog fixture", () => {
    expect(decodeSkillCatalog(catalog)).toEqual(catalog);
    expect(decodeSkillItem(skills[0])).toEqual(skills[0]);
  });

  it("rejects extra fields on the catalog, a skill item, and a diagnostic", () => {
    expect(() => decodeSkillCatalog({ ...catalog, total: 2 })).toThrow("Invalid skill catalog");
    expect(() => decodeSkillCatalog({ skills: [{ ...skills[0], enabled: true }], diagnostics: [] })).toThrow("Invalid skill catalog");
    expect(() => decodeSkillCatalog({ skills: [], diagnostics: [{ ...diagnostics[0], code: "missing_description" }] })).toThrow("Invalid skill catalog");
  });

  it("rejects missing discriminators", () => {
    expect(() => decodeSkillCatalog({ skills: [{ ...skills[0], scope: undefined }], diagnostics: [] })).toThrow("Invalid skill catalog");
    expect(() => decodeSkillCatalog({ skills: [], diagnostics: [{ message: "Missing a type discriminator." }] })).toThrow("Invalid skill catalog");
  });

  it("rejects an unknown scope value", () => {
    expect(() => decodeSkillCatalog({ skills: [{ ...skills[0], scope: "global" }], diagnostics: [] })).toThrow("Invalid skill catalog");
    expect(() => decodeSkillItem({ ...skills[1], scope: "workspace" })).toThrow("Invalid skill item");
  });
});
