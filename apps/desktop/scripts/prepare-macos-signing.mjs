import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function prepareMacosSigningKey({ encodedApiKey, keyId, outputDir }) {
  if (!encodedApiKey) throw new Error("Missing encoded App Store Connect API key");
  if (!/^[A-Z0-9]{10}$/.test(keyId ?? "")) throw new Error("Invalid App Store Connect API key ID");
  if (!outputDir) throw new Error("Missing runner temporary directory");

  const key = Buffer.from(encodedApiKey, "base64").toString("utf8");
  if (!/^-----BEGIN PRIVATE KEY-----\r?\n[\s\S]+\r?\n-----END PRIVATE KEY-----\r?\n?$/.test(key)) {
    throw new Error("Decoded value is not a valid PKCS#8 private key");
  }

  const keyPath = path.join(outputDir, `AuthKey_${keyId}.p8`);
  await writeFile(keyPath, key, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return keyPath;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  prepareMacosSigningKey({
    encodedApiKey: process.env.APPLE_API_KEY_P8,
    keyId: process.env.APPLE_API_KEY_ID,
    outputDir: process.env.RUNNER_TEMP,
  }).then(async (keyPath) => {
    if (!process.env.GITHUB_OUTPUT) throw new Error("Missing GitHub Actions output file");
    await appendFile(process.env.GITHUB_OUTPUT, `apple_api_key=${keyPath}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
