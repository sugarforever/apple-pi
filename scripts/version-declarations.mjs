/**
 * The one place that knows where the release version is declared.
 *
 * The version is not metadata: `apps/desktop/src/main/host-compatibility.ts`
 * compares the desktop's `app.getVersion()` against the agent host's compiled
 * `HOST_VERSION` and refuses to start the host on a mismatch. A release that
 * bumps one declaration and misses another therefore produces an application
 * that cannot open a session, not a cosmetic slip.
 *
 * `check-version-sync.mjs` reads these declarations to fail the build when they
 * disagree; `prepare-release.mjs` writes them together so they cannot.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Every workspace package ships together and nothing is published, so one version covers the repository. */
export const MANIFESTS = [
  "package.json",
  "apps/agent-host/package.json",
  "apps/desktop/package.json",
  "packages/pi-adapter/package.json",
  "packages/protocol/package.json",
];

export const HOST_SOURCE = "apps/agent-host/src/server.ts";
export const HOST_VERSION_PATTERN = /export const HOST_VERSION = "([^"]+)"/;

export async function readManifestVersion(root, relativePath) {
  const manifest = JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`${relativePath} does not declare a version`);
  }
  return manifest.version;
}

export async function readHostVersion(root) {
  const source = await readFile(resolve(root, HOST_SOURCE), "utf8");
  const match = source.match(HOST_VERSION_PATTERN);
  if (!match) throw new Error(`${HOST_SOURCE} does not declare HOST_VERSION`);
  return match[1];
}

/**
 * Rewrites the version in a manifest, preserving key order and the two-space
 * JSON formatting Prettier expects, so `format:check` stays green.
 */
export function rewriteManifestVersion(contents, target) {
  const manifest = JSON.parse(contents);
  manifest.version = target;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function rewriteHostVersion(contents, target) {
  return contents.replace(HOST_VERSION_PATTERN, `export const HOST_VERSION = "${target}"`);
}
