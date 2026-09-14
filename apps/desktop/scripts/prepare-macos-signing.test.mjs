import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { prepareMacosSigningKey } from "./prepare-macos-signing.mjs";

const PRIVATE_KEY = [
  "-----BEGIN PRIVATE KEY-----",
  "dGVzdC1rZXktbWF0ZXJpYWw=",
  "-----END PRIVATE KEY-----",
  "",
].join("\n");
const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("./prepare-macos-signing.mjs", import.meta.url));

test("decodes the API key into a private runner file", async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "apple-pi-signing-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));

  const keyPath = await prepareMacosSigningKey({
    encodedApiKey: Buffer.from(PRIVATE_KEY).toString("base64"),
    keyId: "ABC123DEFG",
    outputDir,
  });

  assert.equal(keyPath, path.join(outputDir, "AuthKey_ABC123DEFG.p8"));
  assert.equal(await readFile(keyPath, "utf8"), PRIVATE_KEY);
  assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
});

test("rejects malformed key material without writing a key file", async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "apple-pi-signing-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));

  await assert.rejects(prepareMacosSigningKey({
    encodedApiKey: Buffer.from("not a private key").toString("base64"),
    keyId: "ABC123DEFG",
    outputDir,
  }), /valid PKCS#8 private key/);
});

test("rejects an unsafe API key identifier", async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "apple-pi-signing-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));

  await assert.rejects(prepareMacosSigningKey({
    encodedApiKey: Buffer.from(PRIVATE_KEY).toString("base64"),
    keyId: "../escape",
    outputDir,
  }), /API key ID/);
});

test("the CLI publishes only the temporary key path as a GitHub output", async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "apple-pi-signing-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const githubOutput = path.join(outputDir, "github-output");

  const result = await execFileAsync(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      APPLE_API_KEY_P8: Buffer.from(PRIVATE_KEY).toString("base64"),
      APPLE_API_KEY_ID: "ABC123DEFG",
      RUNNER_TEMP: outputDir,
      GITHUB_OUTPUT: githubOutput,
    },
  });

  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(await readFile(githubOutput, "utf8"), `apple_api_key=${path.join(outputDir, "AuthKey_ABC123DEFG.p8")}\n`);
});
