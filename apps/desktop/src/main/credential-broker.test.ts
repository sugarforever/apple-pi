import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CredentialBroker, CredentialFile, storagePolicy, type ProtectedStorage } from "./credential-broker.js";
import { setLogLevel } from "./logger.js";

// Quarantine warnings are asserted through storageIssue(); keep them out of the output.
setLogLevel("error");

class FakeStorage implements ProtectedStorage {
  constructor(
    private readonly backend = "keychain",
    private readonly available = true,
  ) {}
  isEncryptionAvailable(): boolean {
    return this.available;
  }
  selectedBackend(): string {
    return this.backend;
  }
  encryptString(value: string): Buffer {
    return Buffer.from(`protected:${[...value].reverse().join("")}`);
  }
  decryptString(value: Buffer): string {
    return [...value.toString().slice("protected:".length)].reverse().join("");
  }
}

async function fixture(platform: NodeJS.Platform = "darwin", backend = "keychain", available = true) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "apple-pi-credentials-"));
  const filePath = path.join(directory, "credentials.json");
  const broker = new CredentialBroker(platform, new FakeStorage(backend, available), new CredentialFile(filePath), () => new Date("2026-09-15T00:00:00.000Z"));
  await broker.initialize();
  return { broker, filePath };
}

describe("CredentialBroker", () => {
  it("persists only encrypted credentials and metadata", async () => {
    const { broker, filePath } = await fixture();
    await broker.setApiKey("openai", "sk-plaintext-must-not-persist");
    const stored = await readFile(filePath, "utf8");
    expect(stored).not.toContain("sk-plaintext-must-not-persist");
    expect(JSON.parse(stored)).toMatchObject({ version: 1, credentials: { openai: { kind: "api_key", updatedAt: "2026-09-15T00:00:00.000Z" } } });
    expect(broker.list()).toEqual([{ providerId: "openai", kind: "api_key", persistence: "persistent", updatedAt: "2026-09-15T00:00:00.000Z" }]);
  });

  it("creates, replaces, reads only for a callback, and deletes a credential", async () => {
    const { broker, filePath } = await fixture();
    await broker.setApiKey("openai", "first");
    await broker.setApiKey("openai", "second");
    expect(await broker.withApiKey("openai", async (value) => `used:${value}`)).toBe("used:second");
    expect(await broker.delete("openai")).toBe(true);
    expect(await broker.withApiKey("openai", async (value) => value)).toBeUndefined();
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses explicit session-only storage for insecure Linux basic_text", async () => {
    const { broker, filePath } = await fixture("linux", "basic_text");
    expect(broker.storagePersistence()).toBe("session");
    expect((await broker.setApiKey("deepseek", "session-secret")).persistence).toBe("session");
    expect(await broker.withApiKey("deepseek", async (value) => value)).toBe("session-secret");
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not expose or decrypt persisted metadata while Linux is degraded", async () => {
    const { broker, filePath } = await fixture();
    await broker.setApiKey("openai", "persisted-secret");
    const degraded = new CredentialBroker("linux", new FakeStorage("basic_text"), new CredentialFile(filePath));
    await degraded.initialize();
    expect(degraded.list()).toEqual([]);
    expect(await degraded.withApiKey("openai", async (value) => value)).toBeUndefined();
    await degraded.setApiKey("openai", "session-replacement");
    const restored = new CredentialBroker("darwin", new FakeStorage(), new CredentialFile(filePath));
    await restored.initialize();
    expect(await restored.withApiKey("openai", async (value) => value)).toBeUndefined();
    expect(await degraded.delete("openai")).toBe(true);
  });
  it("keeps a credential in memory when the OS cannot protect it", async () => {
    // A denied keychain prompt must degrade storage, not prevent the app starting.
    const { broker, filePath } = await fixture("darwin", "keychain", false);
    expect(broker.storagePersistence()).toBe("session");
    expect(broker.storageIssue()).toBe("os_protection_unavailable");
    expect((await broker.setApiKey("openai", "denied-keychain-secret")).persistence).toBe("session");
    expect(await broker.withApiKey("openai", async (value) => value)).toBe("denied-keychain-secret");
    // Without OS protection, nothing may reach disk.
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports a healthy store when OS protection is available", async () => {
    const { broker } = await fixture();
    expect(broker.storageIssue()).toBeUndefined();
  });

  it("quarantines an unreadable store instead of refusing to start", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "apple-pi-credentials-"));
    const filePath = path.join(directory, "credentials.json");
    await writeFile(filePath, "{ not json", "utf8");
    const broker = new CredentialBroker("darwin", new FakeStorage(), new CredentialFile(filePath), () => new Date("2026-09-15T00:00:00.000Z"));

    await expect(broker.initialize()).resolves.toBeUndefined();
    expect(broker.storageIssue()).toBe("store_quarantined");
    expect(broker.list()).toEqual([]);
    expect(await broker.setApiKey("openai", "fresh-secret")).toMatchObject({ persistence: "persistent" });
    expect((await readdir(directory)).filter((entry) => entry.startsWith("credentials.json.corrupt-"))).toHaveLength(1);
  });

  it("does not drop a credential when two providers connect at once", async () => {
    const { broker } = await fixture();
    await Promise.all([broker.setApiKey("openai", "first-secret"), broker.setApiKey("deepseek", "second-secret")]);

    expect(
      broker
        .list()
        .map((item) => item.providerId)
        .sort(),
    ).toEqual(["deepseek", "openai"]);
    expect(await broker.withApiKey("openai", async (value) => value)).toBe("first-secret");
    expect(await broker.withApiKey("deepseek", async (value) => value)).toBe("second-secret");
  });
});

describe("storagePolicy", () => {
  it.each([
    ["darwin", "keychain"],
    ["win32", "dpapi"],
    ["linux", "gnome_libsecret"],
    ["linux", "kwallet6"],
  ] as const)("persists on %s with %s", (platform, backend) => {
    expect(storagePolicy(platform, new FakeStorage(backend))).toBe("persistent");
  });

  it.each([
    ["darwin", "keychain"],
    ["win32", "dpapi"],
    ["linux", "basic_text"],
    ["linux", "unknown"],
  ] as const)("falls back to session storage on %s with %s when OS protection is unavailable", (platform, backend) => {
    expect(storagePolicy(platform, new FakeStorage(backend, false))).toBe("session");
  });
});
