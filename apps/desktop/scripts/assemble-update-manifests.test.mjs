import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { describe, it } from "node:test";

import { assembleUpdateManifests, mergeManifests, parseStagedName } from "./assemble-update-manifests.mjs";

/** Field values copied from a real electron-builder run, so the shape cannot drift unnoticed. */
const ARM64 = {
  version: "0.5.0",
  files: [
    {
      url: "apple-pi-0.5.0-mac-arm64.zip",
      sha512: "wC3Yo0uEp/nh5NPNtd2sfJEcLdcMEWGPG9vSRoOGzpFfOk/dAhc2Iotm6/t7fDENBz0XDIRBF+OHGd+p92x43Q==",
      size: 126084532,
    },
  ],
  path: "apple-pi-0.5.0-mac-arm64.zip",
  sha512: "wC3Yo0uEp/nh5NPNtd2sfJEcLdcMEWGPG9vSRoOGzpFfOk/dAhc2Iotm6/t7fDENBz0XDIRBF+OHGd+p92x43Q==",
  releaseDate: "2026-09-16T00:25:54.468Z",
};

const X64 = {
  version: "0.5.0",
  files: [
    {
      url: "apple-pi-0.5.0-mac-x64.zip",
      sha512: "AR6Hy9cE/HaO6zDOcvRZrvVWUjdGpgTZ9g9cqJk1pR0ncciAYMc1mpCKWPJCd2HZII5wvoHyldB2G6yAkPhIeQ==",
      size: 132626383,
    },
  ],
  path: "apple-pi-0.5.0-mac-x64.zip",
  sha512: "AR6Hy9cE/HaO6zDOcvRZrvVWUjdGpgTZ9g9cqJk1pR0ncciAYMc1mpCKWPJCd2HZII5wvoHyldB2G6yAkPhIeQ==",
  releaseDate: "2026-09-16T00:27:44.373Z",
};

describe("parseStagedName", () => {
  it("reads the platform and arch the collector staged", () => {
    assert.deepEqual(parseStagedName("update-mac-arm64.yml"), { platform: "mac", arch: "arm64" });
    assert.deepEqual(parseStagedName("update-win-x64.yml"), { platform: "win", arch: "x64" });
  });

  it("ignores anything else, including a published manifest", () => {
    assert.equal(parseStagedName("latest-mac.yml"), undefined);
    assert.equal(parseStagedName("update-mac.yml"), undefined);
  });
});

describe("mergeManifests", () => {
  it("lists both architectures, which is the whole point", () => {
    const merged = mergeManifests([ARM64, X64]);
    assert.deepEqual(
      merged.files.map((file) => file.url),
      ["apple-pi-0.5.0-mac-arm64.zip", "apple-pi-0.5.0-mac-x64.zip"],
    );
    assert.equal(merged.version, "0.5.0");
  });

  it("is order independent, because the jobs finish in any order", () => {
    assert.deepEqual(mergeManifests([ARM64, X64]), mergeManifests([X64, ARM64]));
  });

  it("keeps the document self-consistent by pointing path at the first archive", () => {
    const merged = mergeManifests([X64, ARM64]);
    assert.equal(merged.path, merged.files[0].url);
    assert.equal(merged.sha512, merged.files[0].sha512);
    assert.equal(merged.releaseDate, ARM64.releaseDate);
  });

  it("deduplicates an archive listed twice", () => {
    assert.equal(mergeManifests([ARM64, ARM64]).files.length, 1);
  });

  it("refuses manifests that disagree on the version", () => {
    assert.throws(() => mergeManifests([ARM64, { ...X64, version: "0.4.0" }]), /disagree on version/);
  });

  it("refuses a manifest with no files", () => {
    assert.throws(() => mergeManifests([{ ...ARM64, files: [] }]), /lists no files/);
  });
});

const MERGED_MAC = [
  "version: 0.5.0",
  "files:",
  "  - url: apple-pi-0.5.0-mac-arm64.zip",
  "    sha512: wC3Yo0uEp/nh5NPNtd2sfJEcLdcMEWGPG9vSRoOGzpFfOk/dAhc2Iotm6/t7fDENBz0XDIRBF+OHGd+p92x43Q==",
  "    size: 126084532",
  "  - url: apple-pi-0.5.0-mac-x64.zip",
  "    sha512: AR6Hy9cE/HaO6zDOcvRZrvVWUjdGpgTZ9g9cqJk1pR0ncciAYMc1mpCKWPJCd2HZII5wvoHyldB2G6yAkPhIeQ==",
  "    size: 132626383",
  "path: apple-pi-0.5.0-mac-arm64.zip",
  "sha512: wC3Yo0uEp/nh5NPNtd2sfJEcLdcMEWGPG9vSRoOGzpFfOk/dAhc2Iotm6/t7fDENBz0XDIRBF+OHGd+p92x43Q==",
  "releaseDate: '2026-09-16T00:25:54.468Z'",
  "",
].join("\n");

async function stage(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "apple-pi-feed-"));
  const inputDir = path.join(root, "staged");
  await mkdir(inputDir, { recursive: true });
  for (const [name, document] of Object.entries(files)) await writeFile(path.join(inputDir, name), JSON.stringify(document), "utf8");
  return { root, inputDir, outputDir: path.join(root, "feed") };
}

test("writes the canonical manifest each platform's updater looks for", async (t) => {
  const { root, inputDir, outputDir } = await stage({
    "update-mac-arm64.yml": ARM64,
    "update-mac-x64.yml": X64,
    "update-win-x64.yml": { ...X64, files: [{ url: "apple-pi-0.5.0-win-x64-setup.exe", sha512: "win", size: 1 }] },
    "update-linux-x64.yml": { ...X64, files: [{ url: "apple-pi-0.5.0-linux-x64.AppImage", sha512: "linux", size: 2 }] },
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const written = await assembleUpdateManifests({ inputDir, outputDir, platforms: ["mac", "win", "linux"] });

  assert.deepEqual(
    written.map((entry) => path.basename(entry.target)),
    ["latest-mac.yml", "latest.yml", "latest-linux.yml"],
  );
  assert.equal(await readFile(path.join(outputDir, "latest-mac.yml"), "utf8"), MERGED_MAC);
  assert.deepEqual(written[0].archives, ["apple-pi-0.5.0-mac-arm64.zip", "apple-pi-0.5.0-mac-x64.zip"]);
});

test("refuses to publish a feed missing a platform", async (t) => {
  const { root, inputDir, outputDir } = await stage({ "update-win-x64.yml": X64 });
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    assembleUpdateManifests({ inputDir, outputDir, platforms: ["mac", "win", "linux"] }),
    /no update manifest for mac, linux; refusing to publish an incomplete feed/,
  );
});

test("refuses a staged manifest for a platform it does not know", async (t) => {
  const { root, inputDir, outputDir } = await stage({ "update-freebsd-x64.yml": X64 });
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(assembleUpdateManifests({ inputDir, outputDir, platforms: ["mac"] }), /unexpected staged manifest/);
});

test("refuses to run with nothing staged", async (t) => {
  const { root, inputDir, outputDir } = await stage({});
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(assembleUpdateManifests({ inputDir, outputDir, platforms: ["mac"] }), /no staged update manifests/);
});
