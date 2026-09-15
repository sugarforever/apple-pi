#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Asserts that every version declaration in the repository agrees.
 *
 * The version is not metadata: `apps/desktop/src/main/host-compatibility.ts`
 * compares the desktop's `app.getVersion()` against the agent host's compiled
 * `HOST_VERSION` and refuses to start the host on a mismatch. A release that
 * bumps one declaration and misses another therefore produces an application
 * that cannot open a session, not a cosmetic slip.
 *
 * The same script guards the release workflow via `--tag`, because the tag does
 * not carry the version: electron-builder names artifacts and stamps the app
 * from the committed `package.json`, so a tag that disagrees with it publishes
 * a release whose name, asset filenames, and runtime version all differ.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every workspace package ships together and nothing is published, so one version covers the repository. */
const MANIFESTS = [
  "package.json",
  "apps/agent-host/package.json",
  "apps/desktop/package.json",
  "packages/pi-adapter/package.json",
  "packages/protocol/package.json",
];

const HOST_SOURCE = "apps/agent-host/src/server.ts";
const HOST_VERSION_PATTERN = /export const HOST_VERSION = "([^"]+)"/;

async function readManifestVersion(relativePath) {
  const manifest = JSON.parse(await readFile(resolve(ROOT, relativePath), "utf8"));
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`${relativePath} does not declare a version`);
  }
  return manifest.version;
}

async function readHostVersion() {
  const source = await readFile(resolve(ROOT, HOST_SOURCE), "utf8");
  const match = source.match(HOST_VERSION_PATTERN);
  if (!match) throw new Error(`${HOST_SOURCE} does not declare HOST_VERSION`);
  return match[1];
}

function readTagArgument() {
  const index = process.argv.indexOf("--tag");
  if (index === -1) return undefined;
  const tag = process.argv[index + 1];
  if (!tag) throw new Error("--tag requires a value, for example --tag v0.5.0");
  return tag;
}

const failures = [];
const versions = new Map();
for (const manifest of MANIFESTS) versions.set(manifest, await readManifestVersion(manifest));

const [[canonicalManifest, canonicalVersion]] = versions;
for (const [manifest, version] of versions) {
  if (version !== canonicalVersion) {
    failures.push(`${manifest} is ${version}, but ${canonicalManifest} is ${canonicalVersion}`);
  }
}

const hostVersion = await readHostVersion();
const hostManifestVersion = versions.get("apps/agent-host/package.json");
if (hostVersion !== hostManifestVersion) {
  failures.push(`HOST_VERSION in ${HOST_SOURCE} is ${hostVersion}, but apps/agent-host/package.json is ${hostManifestVersion}`);
}

const tag = readTagArgument();
const expectedTag = `v${canonicalVersion}`;
if (tag !== undefined && tag !== expectedTag) {
  failures.push(`tag ${tag} does not match ${expectedTag}, the version in ${canonicalManifest}`);
}

if (failures.length > 0) {
  console.error(`Version declarations disagree:\n${failures.map((failure) => `  ${failure}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(
    `Version declarations agree at ${canonicalVersion} across ${MANIFESTS.length} manifests, and HOST_VERSION matches${tag ? `, and tag ${tag} matches` : ""}.`,
  );
}
