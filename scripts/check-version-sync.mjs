#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findVersionFailures, MANIFESTS, readAllVersions } from "./version-declarations.mjs";

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

function readTagArgument() {
  const index = process.argv.indexOf("--tag");
  if (index === -1) return undefined;
  const tag = process.argv[index + 1];
  if (!tag) throw new Error("--tag requires a value, for example --tag v0.5.0");
  return tag;
}

const { versions, hostVersion } = await readAllVersions(ROOT);
const failures = findVersionFailures({ versions, hostVersion });

const [[canonicalManifest, canonicalVersion]] = versions;
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
