/**
 * The one place that knows where the release version is declared.
 *
 * electron-builder stamps the app and names its artifacts from
 * `apps/desktop/package.json`, while the root manifest is what a release pull
 * request bumps. `check-version-sync.mjs` fails the build when they disagree;
 * `prepare-release.mjs` writes them together so they cannot.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Every workspace package ships together and nothing is published, so one version covers the repository. */
export const MANIFESTS = ["package.json", "apps/desktop/package.json"];

export async function readManifestVersion(root, relativePath) {
  const manifest = JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`${relativePath} does not declare a version`);
  }
  return manifest.version;
}

/** Every manifest version, read together so a caller can check them as one tree. */
export async function readAllVersions(root) {
  const versions = new Map();
  for (const manifest of MANIFESTS) versions.set(manifest, await readManifestVersion(root, manifest));
  return versions;
}

/**
 * Every manifest that does not match the canonical (first) manifest. Collects
 * every failure instead of stopping at the first, so both check-version-sync.mjs
 * and prepare-release.mjs report a tangled tree in full.
 */
export function findVersionFailures(versions) {
  const failures = [];
  const [[canonicalManifest, canonicalVersion]] = versions;
  for (const [manifest, version] of versions) {
    if (version !== canonicalVersion) {
      failures.push(`${manifest} is ${version}, but ${canonicalManifest} is ${canonicalVersion}`);
    }
  }
  return failures;
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
