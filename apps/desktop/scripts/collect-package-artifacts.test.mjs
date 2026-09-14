import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectPackageArtifacts } from "./collect-package-artifacts.mjs";

test("collects only expected packages and writes portable SHA-256 sidecars", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apple-pi-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releaseDir = path.join(root, "release");
  const outputRoot = path.join(root, "artifacts");
  await mkdir(path.join(releaseDir, "mac-arm64"), { recursive: true });
  await writeFile(path.join(releaseDir, "apple-pi-0.1.0-mac-arm64.dmg"), "dmg");
  await writeFile(path.join(releaseDir, "apple-pi-0.1.0-mac-arm64.zip"), "zip");
  await writeFile(path.join(releaseDir, "builder-debug.yml"), "ignored");

  const outputDir = await collectPackageArtifacts({
    releaseDir,
    outputRoot,
    version: "0.1.0",
    osName: "macos",
    artifactOs: "mac",
    arch: "arm64",
    extensions: ["dmg", "zip"],
  });

  assert.equal(outputDir, path.join(outputRoot, "apple-pi-0.1.0-macos-arm64"));
  assert.deepEqual(await readdir(outputDir), [
    "apple-pi-0.1.0-mac-arm64.dmg",
    "apple-pi-0.1.0-mac-arm64.dmg.sha256",
    "apple-pi-0.1.0-mac-arm64.zip",
    "apple-pi-0.1.0-mac-arm64.zip.sha256",
  ]);
  assert.equal(
    await readFile(path.join(outputDir, "apple-pi-0.1.0-mac-arm64.dmg.sha256"), "utf8"),
    "00cbbd0ddbda2762798f7009838ed34ca1f12b93965813c7df22943bc62166d1  apple-pi-0.1.0-mac-arm64.dmg\n",
  );
});

test("rejects a release directory with no matching package", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apple-pi-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releaseDir = path.join(root, "release");
  await mkdir(releaseDir);

  await assert.rejects(collectPackageArtifacts({
    releaseDir,
    outputRoot: path.join(root, "artifacts"),
    version: "0.1.0",
    osName: "windows",
    artifactOs: "win",
    arch: "x64",
    extensions: ["exe"],
  }), /No packaged artifacts matched apple-pi-0\.1\.0-win-x64/);
});

test("collects distinct installer targets that share an extension", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apple-pi-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releaseDir = path.join(root, "release");
  const outputRoot = path.join(root, "artifacts");
  await mkdir(releaseDir);
  await writeFile(path.join(releaseDir, "apple-pi-0.1.0-win-x64-setup.exe"), "setup");
  await writeFile(path.join(releaseDir, "apple-pi-0.1.0-win-x64-portable.exe"), "portable");

  const outputDir = await collectPackageArtifacts({
    releaseDir,
    outputRoot,
    version: "0.1.0",
    osName: "windows",
    artifactOs: "win",
    arch: "x64",
    extensions: ["exe"],
  });

  assert.deepEqual((await readdir(outputDir)).filter((file) => !file.endsWith(".sha256")), [
    "apple-pi-0.1.0-win-x64-portable.exe",
    "apple-pi-0.1.0-win-x64-setup.exe",
  ]);
});
