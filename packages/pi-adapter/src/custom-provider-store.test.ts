import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CustomProviderStore, validateCustomProviderDefinition } from "./custom-provider-store.js";

const definition = {
  id: "my-local-llm",
  name: "My Local LLM",
  baseUrl: "https://localhost:8080/v1",
  api: "openai-completions" as const,
  models: [{ id: "local-model-a", name: "Local Model A", contextWindow: 8192, maxTokens: 2048 }],
};

const temporaryDirectories: string[] = [];
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "apple-pi-custom-provider-store-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup() {
  const directory = await temporaryDirectory();
  const manifestPath = path.join(directory, "apple-pi-custom-providers.json");
  const modelsJsonPath = path.join(directory, "models.json");
  const store = new CustomProviderStore(manifestPath, modelsJsonPath);
  return { store, manifestPath, modelsJsonPath };
}

describe("validateCustomProviderDefinition", () => {
  it("accepts a well-formed definition", () => {
    expect(validateCustomProviderDefinition(definition, [])).toBeUndefined();
  });

  it("rejects a duplicate provider id", () => {
    expect(validateCustomProviderDefinition(definition, ["my-local-llm"])).toMatch(/already in use/);
  });

  it("rejects a base URL that is not an absolute http(s) URL", () => {
    expect(validateCustomProviderDefinition({ ...definition, baseUrl: "not-a-url" }, [])).toMatch(/http or https/);
    expect(validateCustomProviderDefinition({ ...definition, baseUrl: "ftp://example.com" }, [])).toMatch(/http or https/);
  });

  it("rejects duplicate model ids", () => {
    expect(validateCustomProviderDefinition({ ...definition, models: [{ id: "dup" }, { id: "dup" }] }, [])).toMatch(/duplicate model id/i);
  });

  it("rejects an empty model id", () => {
    expect(validateCustomProviderDefinition({ ...definition, models: [{ id: "  " }] }, [])).toMatch(/non-empty id/i);
  });
});

describe("CustomProviderStore", () => {
  it("writes only the non-secret provider shape into models.json, never an apiKey field", async () => {
    const { store, modelsJsonPath } = await setup();
    await store.upsert(definition);

    const raw = JSON.parse(await readFile(modelsJsonPath, "utf8"));
    expect(raw.providers["my-local-llm"]).toMatchObject({
      name: "My Local LLM",
      baseUrl: "https://localhost:8080/v1",
      api: "openai-completions",
      models: [{ id: "local-model-a", name: "Local Model A", contextWindow: 8192, maxTokens: 2048 }],
    });
    expect(JSON.stringify(raw)).not.toContain("apiKey");
  });

  it("lists what it manages and round-trips a definition through the manifest", async () => {
    const { store } = await setup();
    await store.upsert(definition);

    expect(await store.list()).toEqual([definition]);
    expect(await store.get("my-local-llm")).toEqual(definition);
    expect(await store.get("unknown")).toBeUndefined();
  });

  it("preserves foreign provider entries already present in models.json (hand-edited or Pi-CLI-written)", async () => {
    const { store, modelsJsonPath } = await setup();
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(modelsJsonPath), { recursive: true });
    await writeFile(modelsJsonPath, JSON.stringify({ providers: { anthropic: { modelOverrides: { "claude-x": { name: "Renamed" } } } } }));

    await store.upsert(definition);
    const raw = JSON.parse(await readFile(modelsJsonPath, "utf8"));
    expect(raw.providers.anthropic).toEqual({ modelOverrides: { "claude-x": { name: "Renamed" } } });
    expect(raw.providers["my-local-llm"]).toBeDefined();
  });

  it("removes only its own key from models.json and forgets the definition", async () => {
    const { store, modelsJsonPath } = await setup();
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(modelsJsonPath), { recursive: true });
    await writeFile(modelsJsonPath, JSON.stringify({ providers: { anthropic: { modelOverrides: {} } } }));

    await store.upsert(definition);
    expect(await store.remove("my-local-llm")).toBe(true);

    const raw = JSON.parse(await readFile(modelsJsonPath, "utf8"));
    expect(raw.providers["my-local-llm"]).toBeUndefined();
    expect(raw.providers.anthropic).toEqual({ modelOverrides: {} });
    expect(await store.list()).toEqual([]);
  });

  it("returns false when removing a provider it does not manage", async () => {
    const { store } = await setup();
    expect(await store.remove("unknown")).toBe(false);
  });

  it("updates an existing definition in place", async () => {
    const { store, modelsJsonPath } = await setup();
    await store.upsert(definition);
    await store.upsert({ ...definition, name: "Renamed LLM" });

    expect(await store.get("my-local-llm")).toMatchObject({ name: "Renamed LLM" });
    const raw = JSON.parse(await readFile(modelsJsonPath, "utf8"));
    expect(raw.providers["my-local-llm"].name).toBe("Renamed LLM");
  });

  it("tolerates a models.json that does not exist yet", async () => {
    const { store } = await setup();
    expect(await store.list()).toEqual([]);
    await expect(store.upsert(definition)).resolves.toBeUndefined();
  });

  it("refuses to touch a models.json file that is not valid JSON, to avoid destroying it", async () => {
    const { store, modelsJsonPath } = await setup();
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(modelsJsonPath), { recursive: true });
    await writeFile(modelsJsonPath, "{ not json");

    await expect(store.upsert(definition)).rejects.toThrow(/models\.json/);
  });
});
