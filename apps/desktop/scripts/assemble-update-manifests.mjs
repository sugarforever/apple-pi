#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Turns the per-build update manifests into the one file each platform's updater
 * looks for.
 *
 * electron-builder names the feed after the platform, not the build, so a
 * two-architecture macOS release produces two manifests both called
 * latest-mac.yml — each listing only the archive that job built. Uploaded to the
 * same release, the second replaces the first, and the updater on the other
 * architecture finds no file matching its own and silently never updates. So the
 * macOS manifests are collected under build-specific names and merged here.
 *
 * The names come from app-builder-lib's getUpdateInfoFileName():
 * `-${buildConfigurationKey}` on every platform except Windows, plus an arch
 * suffix only outside x64 on Linux. That is why macOS needs merging and the
 * others do not, and why this only runs before the release is published.
 */
const CANONICAL_NAMES = {
  mac: "latest-mac.yml",
  win: "latest.yml",
  linux: "latest-linux.yml",
};

/** `update-<platform>-<arch>.yml`, the name the collector stages. */
const STAGED_PATTERN = /^update-([a-z]+)-([a-z0-9]+)\.yml$/;

function unquote(value) {
  return value.length > 1 && value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
}

/**
 * electron-builder writes the feed as YAML, every field flat and machine
 * generated, and this runs in the publish job where nothing is installed — so it
 * is parsed here rather than with a dependency.
 *
 * Anything unrecognised throws. A format change upstream has to fail the
 * release, rather than quietly parse into a feed listing no archives, which is
 * the failure this whole script exists to prevent. The error names the line, so
 * extending the parser is mechanical.
 */
export function parseManifest(contents) {
  const document = {};
  const files = [];
  let current;

  for (const [index, raw] of contents.split("\n").entries()) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "" || line === "files:") continue;

    const archive = line.match(/^ {2}- url: (.+)$/);
    if (archive) {
      current = { url: unquote(archive[1]) };
      files.push(current);
      continue;
    }

    const archiveField = line.match(/^ {4}(sha512|size): (.+)$/);
    if (archiveField && current) {
      current[archiveField[1]] = archiveField[1] === "size" ? Number(archiveField[2]) : unquote(archiveField[2]);
      continue;
    }

    const scalar = line.match(/^(version|path|sha512|releaseDate): (.+)$/);
    if (scalar) {
      document[scalar[1]] = unquote(scalar[2]);
      continue;
    }

    throw new Error(`unsupported line ${index + 1} in update manifest: ${line}`);
  }

  if (typeof document.version !== "string" || files.length === 0) throw new Error("update manifest lists no version or no files");
  return { ...document, files };
}

export function parseStagedName(name) {
  const match = name.match(STAGED_PATTERN);
  if (!match) return undefined;
  return { platform: match[1], arch: match[2] };
}

/**
 * Merges one platform's staged manifests into its canonical manifest.
 *
 * Ordering is normalised (deduplicated and sorted by archive name) because the
 * jobs finish in whatever order they finish.
 */
export function mergeManifests(documents) {
  const [first, ...rest] = documents;
  const versions = new Set(documents.map((document) => document.version));
  if (versions.size !== 1) {
    throw new Error(`staged manifests disagree on version: ${[...versions].sort().join(", ")}`);
  }

  const files = new Map();
  for (const document of documents) {
    if (!Array.isArray(document.files) || document.files.length === 0) throw new Error(`manifest for ${document.version} lists no files`);
    for (const file of document.files) {
      if (typeof file?.url !== "string" || file.url.length === 0) throw new Error("manifest contains a file without a url");
      files.set(file.url, file);
    }
  }
  const ordered = [...files.values()].sort((left, right) => left.url.localeCompare(right.url));

  // Keep any field a future electron-builder adds, then set the ones this script
  // owns. The legacy top-level path/sha512 pair is made to agree with the first
  // archive after sorting, so the document stays self-consistent.
  return {
    ...Object.assign({}, first, ...rest),
    version: first.version,
    files: ordered,
    path: ordered[0].url,
    sha512: ordered[0].sha512,
    releaseDate: documents
      .map((document) => document.releaseDate)
      .filter(Boolean)
      .sort()[0],
  };
}

/**
 * @param platforms the platforms whose manifests must be present, for example
 *                  `["mac", "win", "linux"]` — the caller knows what the matrix
 *                  built, and a platform missing here means its users stop
 *                  receiving updates
 */
export async function assembleUpdateManifests({ inputDir, outputDir, platforms, canonicalNames = CANONICAL_NAMES }) {
  const staged = (await readdir(inputDir)).filter((name) => STAGED_PATTERN.test(name)).sort();
  if (staged.length === 0) throw new Error(`no staged update manifests found in ${inputDir}`);

  const byPlatform = new Map();
  for (const name of staged) {
    const { platform } = parseStagedName(name);
    if (!(platform in canonicalNames)) throw new Error(`unexpected staged manifest ${name}; expected one of ${platforms.join(", ")}`);
    const documents = byPlatform.get(platform) ?? [];
    documents.push({ name, document: parseManifest(await readFile(path.join(inputDir, name), "utf8")) });
    byPlatform.set(platform, documents);
  }

  const missing = platforms.filter((platform) => !byPlatform.has(platform));
  if (missing.length > 0) throw new Error(`no update manifest for ${missing.join(", ")}; refusing to publish an incomplete feed`);

  await mkdir(outputDir, { recursive: true });
  const written = [];
  for (const platform of platforms) {
    const documents = [...byPlatform.get(platform)].sort((left, right) => left.name.localeCompare(right.name));
    const merged = mergeManifests(documents.map((entry) => entry.document));
    const target = path.join(outputDir, canonicalNames[platform]);
    await writeFile(target, serialize(merged), "utf8");
    written.push({ platform, target, archives: merged.files.map((file) => file.url) });
  }
  return written;
}

/**
 * Written by hand rather than with a YAML dependency: these documents are shallow
 * (scalars, one array of three-field maps) and the feed is parsed by
 * electron-updater, so the shape has to be exactly what it expects.
 */
function serialize(manifest) {
  const lines = [`version: ${manifest.version}`, "files:"];
  for (const file of manifest.files) {
    lines.push(`  - url: ${file.url}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`);
  }
  lines.push(`path: ${manifest.path}`, `sha512: ${manifest.sha512}`);
  if (manifest.releaseDate) lines.push(`releaseDate: '${manifest.releaseDate}'`);
  return `${lines.join("\n")}\n`;
}

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argument = (name) => {
    const index = process.argv.indexOf(name);
    const value = index === -1 ? undefined : process.argv[index + 1];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };

  try {
    const inputDir = path.resolve(argument("--input"));
    const outputDir = path.resolve(argument("--output"));
    const platforms = argument("--expect").split(",");
    const written = await assembleUpdateManifests({ inputDir, outputDir, platforms });
    for (const entry of written) console.log(`${entry.target} (${entry.platform}): ${entry.archives.join(", ")}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
