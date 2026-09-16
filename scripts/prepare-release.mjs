#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { findVersionFailures, HOST_SOURCE, MANIFESTS, readAllVersions, rewriteHostVersion, rewriteManifestVersion } from "./version-declarations.mjs";

/**
 * Writes a release version into every declaration at once.
 *
 * The procedure it supports is deliberately still manual: this produces the
 * contents of a `chore: prepare vX.Y.Z release` pull request, which is reviewed
 * and merged, and the tag is pushed afterwards. Automating the tag is not safe
 * here — GitHub does not run workflows for events caused by `GITHUB_TOKEN`, so a
 * bot-created tag would produce no artifacts and no error, because the package
 * workflow triggers on `push: tags`.
 *
 * Usage:
 *   node scripts/prepare-release.mjs 0.6.0 [--dry-run]
 *   node scripts/prepare-release.mjs --minor [--dry-run]
 */

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const BUMP_KINDS = { "--major": "major", "--minor": "minor", "--patch": "patch" };
const usage = "usage: node scripts/prepare-release.mjs <version>|--patch|--minor|--major [--dry-run]";

function parts(version) {
  const match = version.match(VERSION_PATTERN);
  if (!match) throw new Error(`not a version: ${version}`);
  return version.split(".").map(Number);
}

export function compareVersions(left, right) {
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

/**
 * @param args arguments after the script name
 * @param current the version currently declared in the repository
 */
export function resolveTarget(args, current) {
  const target = args.find((argument) => !argument.startsWith("--"));
  const bumpFlag = args.find((argument) => argument in BUMP_KINDS);
  if (target && bumpFlag) throw new Error(`give either a version or a bump flag, not both. ${usage}`);
  if (!target && !bumpFlag) throw new Error(`no version given. ${usage}`);

  if (target) {
    if (!VERSION_PATTERN.test(target)) throw new Error(`not a version: ${target}. ${usage}`);
    if (compareVersions(target, current) <= 0) throw new Error(`target ${target} must be greater than the current ${current}`);
    return target;
  }

  const [major, minor, patch] = parts(current);
  switch (BUMP_KINDS[bumpFlag]) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

const run = promisify(execFile);

/** Returns the most recent tag reachable from HEAD, or undefined when there is none. */
async function lastTag(root, exec) {
  try {
    const { stdout } = await exec("git", ["describe", "--tags", "--abbrev=0"], { cwd: root });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function tagExists(root, exec, tag) {
  const { stdout } = await exec("git", ["tag", "--list", tag], { cwd: root });
  return stdout.trim().length > 0;
}

async function commitsSince(root, exec, tag) {
  const range = tag ? [`${tag}..HEAD`] : [];
  // --no-merges: the branch commits carry the Conventional Commits, the merge
  // commits do not, and the release pull request body wants the former.
  const { stdout } = await exec("git", ["log", "--no-merges", "--pretty=format:%s", ...range], { cwd: root });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * @returns the files that were (or would be) written, the resolved target, and
 *          the commits the release would cover
 */
export async function prepareRelease({ root, args, dryRun = false, exec = run }) {
  const { versions, hostVersion } = await readAllVersions(root);
  const failures = findVersionFailures({ versions, hostVersion });
  if (failures.length > 0) {
    throw new Error(`version declarations disagree; run pnpm versions:check:\n${failures.map((failure) => `  ${failure}`).join("\n")}`);
  }

  const current = versions.get("package.json");
  const target = resolveTarget(args, current);

  if (await tagExists(root, exec, `v${target}`)) {
    throw new Error(`tag v${target} already exists; release a later version`);
  }

  const writes = [];
  for (const manifest of MANIFESTS) {
    const path = resolve(root, manifest);
    const original = await readFile(path, "utf8");
    writes.push({ path, original, contents: rewriteManifestVersion(original, target) });
  }
  const hostPath = resolve(root, HOST_SOURCE);
  const hostOriginal = await readFile(hostPath, "utf8");
  writes.push({ path: hostPath, original: hostOriginal, contents: rewriteHostVersion(hostOriginal, target) });

  if (!dryRun) {
    // Six files, one release: a write that fails partway through must not leave
    // some declarations at the new version and others at the old one, so undo
    // whatever already landed before surfacing the error.
    const applied = [];
    try {
      for (const write of writes) {
        await writeFile(write.path, write.contents, "utf8");
        applied.push(write);
      }
    } catch (error) {
      for (const write of applied.reverse()) await writeFile(write.path, write.original, "utf8").catch(() => {});
      throw error;
    }
  }

  const tag = await lastTag(root, exec);
  return { current, target, tag, commits: await commitsSince(root, exec, tag), files: writes.map((write) => write.path) };
}

function isCli() {
  return process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isCli()) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dryRun = process.argv.includes("--dry-run");
  try {
    const result = await prepareRelease({ root, args: process.argv.slice(2), dryRun });
    const verb = dryRun ? "Would write" : "Wrote";
    console.log(`${verb} ${result.target} (from ${result.current}) into ${result.files.length} files:`);
    for (const file of result.files) console.log(`  ${file.slice(root.length + 1)}`);
    if (result.commits.length > 0) {
      console.log(`\nCommits since ${result.tag ?? "the beginning"}, for the release pull request body:`);
      for (const commit of result.commits) console.log(`  ${commit}`);
    }
    if (dryRun) console.log("\nDry run: nothing was written.");
    else
      console.log(
        "\nNext: pnpm verify, commit as 'chore: prepare v%s release', open the pull request, and tag the merge commit after it lands.",
        result.target,
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
