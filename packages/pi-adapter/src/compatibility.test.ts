import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { PI_VERSION, mapPiEvent, mapPiMessages, mapPiModel, mapPiSessionItem } from "./index.js";

const fixtureUrl = (name: string) => new URL(`../test/fixtures/pi-0.84.2/${name}`, import.meta.url);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "apple-pi-compatibility-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Pi 0.84.2 mapper compatibility", () => {
  it("replays the sanitized Pi boundary corpus", async () => {
    const piPackageUrl = new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent"));
    const piPackage = JSON.parse(await readFile(piPackageUrl, "utf8")) as { version: string };
    const manifest = JSON.parse(await readFile(fixtureUrl("manifest.json"), "utf8")) as {
      piVersion: string;
      sanitized: boolean;
    };
    const fixtures = JSON.parse(await readFile(fixtureUrl("mapper-cases.json"), "utf8")) as {
      messages: { input: unknown; expected: unknown };
      events: Array<{ name: string; input: unknown; expected: unknown }>;
      models: Array<{ input: unknown; expected: unknown }>;
      sessions: Array<{ input: unknown; expected: unknown }>;
    };

    expect(manifest).toMatchObject({ piVersion: PI_VERSION, sanitized: true });
    expect(piPackage.version).toBe(manifest.piVersion);
    expect(mapPiMessages(fixtures.messages.input)).toEqual(fixtures.messages.expected);
    for (const fixture of fixtures.events) expect(mapPiEvent(fixture.input), fixture.name).toEqual(fixture.expected);
    for (const fixture of fixtures.models) expect(mapPiModel(fixture.input)).toEqual(fixture.expected);
    for (const fixture of fixtures.sessions) expect(mapPiSessionItem(fixture.input)).toEqual(fixture.expected);
  });
});

describe("Pi 0.84.2 public SDK compatibility", () => {
  it("creates, opens, and lists persisted sessions through the public SessionManager API", async () => {
    const root = await temporaryDirectory();
    const cwd = join(root, "workspace");
    const sessionDirectory = join(root, "sessions");
    const created = SessionManager.create(cwd, sessionDirectory, { id: "00000000-0000-4000-8000-000000000842" });
    created.appendMessage({ role: "user", content: "Synthetic SDK request", timestamp: 1000 });
    created.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Synthetic SDK response" }],
      api: "openai-completions",
      provider: "fixture-provider",
      model: "fixture-model-a",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 2000,
    });
    created.appendModelChange("fixture-provider", "fixture-model-b");

    const sessionFile = created.getSessionFile();
    expect(sessionFile).toEqual(expect.any(String));
    const opened = SessionManager.open(sessionFile!, sessionDirectory, cwd);
    const listed = await SessionManager.list(cwd, sessionDirectory);

    expect(opened.getSessionId()).toBe(created.getSessionId());
    expect(opened.getSessionId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(opened.buildSessionContext()).toMatchObject({
      messages: [
        { role: "user", content: "Synthetic SDK request", timestamp: 1000 },
        { role: "assistant", content: [{ type: "text", text: "Synthetic SDK response" }] },
      ],
      model: { provider: "fixture-provider", modelId: "fixture-model-b" },
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: opened.getSessionId(), path: sessionFile, messageCount: 2 });
  });

  it("keeps the AgentSession cancellation and model-switching surface compatible", async () => {
    type Options = NonNullable<Parameters<typeof createAgentSession>[0]>;
    const root = await temporaryDirectory();
    const runtime = await ModelRuntime.create({
      authPath: join(root, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(root, "models-cache.json"),
      refreshOnCreate: false,
    });
    runtime.registerProvider("fixture-provider", {
      api: "openai-completions",
      baseUrl: "https://invalid.example",
      apiKey: "fixture-token",
      models: [{
        id: "fixture-model-b",
        name: "Fixture Model B",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 512,
      }],
    });
    const model = {
      id: "fixture-model-a",
      name: "Fixture Model A",
      api: "openai-completions",
      provider: "fixture-provider",
      baseUrl: "https://invalid.example",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 512,
    } as const satisfies NonNullable<Options["model"]>;
    const { session } = await createAgentSession({
      cwd: root,
      agentDir: join(root, "agent"),
      sessionManager: SessionManager.inMemory(root),
      modelRuntime: runtime,
      model,
      noTools: "all",
    });

    expectTypeOf(session.subscribe).toBeFunction();
    expectTypeOf(session.abort).toBeFunction();
    expectTypeOf(session.setModel).toBeFunction();
    const unsubscribe = session.subscribe(() => undefined);
    await session.abort();
    await session.setModel({ ...model, id: "fixture-model-b", name: "Fixture Model B" });

    expect(session.model?.id).toBe("fixture-model-b");
    unsubscribe();
    session.dispose();
  });

  it("restores the legacy JSONL identity, projected messages, model, and active path", async () => {
    const root = await temporaryDirectory();
    const restoredPath = join(root, basename(fixtureUrl("legacy-session-v3.jsonl").pathname));
    await copyFile(fixtureUrl("legacy-session-v3.jsonl"), restoredPath);

    const restored = SessionManager.open(restoredPath, root, join(root, "workspace"));
    const context = restored.buildSessionContext();

    expect(restored.getSessionId()).toBe("00000000-0000-4000-8000-000000000084");
    expect(restored.getLeafId()).toBe("e5f6a7b8");
    expect(restored.getBranch().map((entry) => entry.id)).toEqual(["a1b2c3d4", "b2c3d4e5", "d4e5f6a7", "e5f6a7b8"]);
    expect(context.model).toEqual({ provider: "fixture-provider", modelId: "fixture-model-b" });
    expect(mapPiMessages(context.messages)).toEqual([
      { role: "user", content: [{ type: "text", text: "Synthetic legacy request" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", text: "Synthetic legacy thought" },
          { type: "tool_call", id: "call-legacy-1", name: "fixture_tool", arguments: { target: "sample.txt" } },
          { type: "text", text: "Synthetic legacy response" },
        ],
      },
      {
        role: "tool",
        content: [{ type: "tool_result", toolCallId: "call-legacy-1", name: "fixture_tool", output: [{ type: "text", text: "Synthetic legacy output" }], isError: false }],
      },
    ]);
  });
});
