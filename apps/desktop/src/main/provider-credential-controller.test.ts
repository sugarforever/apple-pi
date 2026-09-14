import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CredentialBroker, CredentialFile, type ProtectedStorage } from "./credential-broker.js";
import { ProviderCredentialController, type ProviderHost } from "./provider-credential-controller.js";

const provider = { id: "openai", name: "OpenAI", authMethods: ["api_key" as const], status: "connected" as const, credentialSource: "apple_pi" as const, availableModelCount: 1, diagnostics: [] };

class FakeStorage implements ProtectedStorage {
  constructor(private readonly backend: string) {}
  isEncryptionAvailable(): boolean { return true; }
  selectedBackend(): string { return this.backend; }
  encryptString(value: string): Buffer { return Buffer.from(`encrypted:${value}`); }
  decryptString(value: Buffer): string { return value.toString().slice("encrypted:".length); }
}

async function setup(platform: NodeJS.Platform = "darwin", backend = "keychain") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "apple-pi-controller-"));
  const broker = new CredentialBroker(platform, new FakeStorage(backend), new CredentialFile(path.join(directory, "credentials.json")));
  await broker.initialize();
  const request = vi.fn(async (type: string) => type === "provider.list" ? [] : type === "model.refresh" ? { providers: [], models: [], diagnostics: [] } : { provider, diagnostics: [] });
  const controller = new ProviderCredentialController(broker, { request } as unknown as ProviderHost, () => "credential-test");
  return { broker, controller, request };
}

describe("ProviderCredentialController", () => {
  it("persists after a successful connection without returning the key", async () => {
    const { broker, controller } = await setup();
    const result = await controller.connect({ providerId: "openai", apiKey: "renderer-secret", operationId: "connect", timeoutMs: 1_000 });
    expect(JSON.stringify(result)).not.toContain("renderer-secret");
    expect(broker.list()).toMatchObject([{ providerId: "openai", persistence: "persistent" }]);
  });

  it("reports Linux basic_text as session-only using a sanitized response", async () => {
    const { controller } = await setup("linux", "basic_text");
    const result = await controller.connect({ providerId: "openai", apiKey: "session-secret", operationId: "connect", timeoutMs: 1_000 });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "secure_storage_unavailable", severity: "warning" }));
    expect(JSON.stringify(result)).not.toContain("session-secret");
  });

  it("decrypts only while supplying the isolated host and removes metadata on disconnect", async () => {
    const { broker, controller, request } = await setup();
    await broker.setApiKey("openai", "runtime-only-secret");
    await controller.verify({ providerId: "openai", operationId: "verify", timeoutMs: 1_000 });
    expect(request).toHaveBeenCalledWith("provider.connectApiKey", expect.objectContaining({ apiKey: "runtime-only-secret", operationId: "credential-test" }));
    await controller.provide("openai");
    expect(request.mock.calls.filter(([type]) => type === "provider.connectApiKey")).toHaveLength(1);
    const publicResult = await controller.list();
    expect(JSON.stringify(publicResult)).not.toContain("runtime-only-secret");
    await controller.disconnect({ providerId: "openai", operationId: "delete", timeoutMs: 1_000 });
    expect(broker.list()).toEqual([]);
  });
});
