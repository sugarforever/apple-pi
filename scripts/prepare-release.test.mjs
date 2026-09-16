import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { compareVersions, prepareRelease, resolveTarget } from "./prepare-release.mjs";
import { HOST_SOURCE, MANIFESTS, readHostVersion, readManifestVersion, rewriteHostVersion, rewriteManifestVersion } from "./version-declarations.mjs";

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    assert.equal(compareVersions("0.5.0", "0.5.0"), 0);
    assert.equal(compareVersions("0.5.1", "0.5.0"), 1);
    assert.equal(compareVersions("0.5.0", "0.6.0"), -1);
    assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
    assert.equal(compareVersions("0.10.0", "0.9.0"), 1);
  });
});

describe("resolveTarget", () => {
  it("accepts an explicit version", () => {
    assert.equal(resolveTarget(["0.6.0"], "0.5.0"), "0.6.0");
  });

  it("derives each bump kind", () => {
    assert.equal(resolveTarget(["--patch"], "0.5.0"), "0.5.1");
    assert.equal(resolveTarget(["--minor"], "0.5.0"), "0.6.0");
    assert.equal(resolveTarget(["--major"], "0.5.0"), "1.0.0");
  });

  it("ignores unrelated flags such as --dry-run", () => {
    assert.equal(resolveTarget(["--minor", "--dry-run"], "0.5.0"), "0.6.0");
  });

  it("refuses a version that does not advance", () => {
    assert.throws(() => resolveTarget(["0.5.0"], "0.5.0"), /must be greater/);
    assert.throws(() => resolveTarget(["0.4.0"], "0.5.0"), /must be greater/);
  });

  it("refuses malformed input", () => {
    assert.throws(() => resolveTarget(["v0.6.0"], "0.5.0"), /not a version/);
    assert.throws(() => resolveTarget(["0.6"], "0.5.0"), /not a version/);
    assert.throws(() => resolveTarget([], "0.5.0"), /no version given/);
    assert.throws(() => resolveTarget(["0.6.0", "--minor"], "0.5.0"), /not both/);
  });
});

describe("rewriting", () => {
  it("changes only the version and keeps the manifest shape", () => {
    const original = '{\n  "name": "@apple-pi/desktop",\n  "productName": "Apple Pi",\n  "version": "0.5.0",\n  "private": true\n}\n';
    const updated = rewriteManifestVersion(original, "0.6.0");
    assert.equal(updated, original.replace('"0.5.0"', '"0.6.0"'));
  });

  it("rewrites the compiled host constant in place", () => {
    assert.equal(rewriteHostVersion('export const HOST_VERSION = "0.5.0" as const;\n', "0.6.0"), 'export const HOST_VERSION = "0.6.0" as const;\n');
  });

  it("leaves a file that does not declare the constant alone", () => {
    assert.equal(rewriteHostVersion("export const other = 1;\n", "0.6.0"), "export const other = 1;\n");
  });
});

/** A scratch repository containing only the declarations, so the write pass is exercised for real. */
async function fixture(root) {
  for (const manifest of MANIFESTS) {
    await mkdir(dirname(join(root, manifest)), { recursive: true });
    await writeFile(join(root, manifest), `{\n  "name": "fixture",\n  "version": "0.5.0"\n}\n`, "utf8");
  }
  await mkdir(dirname(join(root, HOST_SOURCE)), { recursive: true });
  await writeFile(join(root, HOST_SOURCE), 'export const HOST_VERSION = "0.5.0" as const;\n', "utf8");
}

/** Stands in for git so the tests do not depend on this repository's history. */
function fakeGit({ tags = new Set(), commits = [], lastTag } = {}) {
  return async (_command, args) => {
    if (args[0] === "tag" && args[1] === "--list") return { stdout: tags.has(args[2]) ? `${args[2]}\n` : "" };
    if (args[0] === "describe") {
      if (!lastTag) throw new Error("no tags");
      return { stdout: `${lastTag}\n` };
    }
    if (args[0] === "log") return { stdout: commits.join("\n") };
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
}

describe("prepareRelease", () => {
  let root;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "apple-pi-release-"));
    await fixture(root);
  });

  it("writes every declaration together", async () => {
    const result = await prepareRelease({ root, args: ["0.6.0"], exec: fakeGit({ lastTag: "v0.5.0", commits: ["feat: x", "fix: y"] }) });

    assert.equal(result.current, "0.5.0");
    assert.equal(result.target, "0.6.0");
    assert.equal(result.files.length, MANIFESTS.length + 1);
    for (const manifest of MANIFESTS) assert.equal(await readManifestVersion(root, manifest), "0.6.0");
    assert.equal(await readHostVersion(root), "0.6.0");
    assert.deepEqual(result.commits, ["feat: x", "fix: y"]);
  });

  it("writes nothing on a dry run", async () => {
    await prepareRelease({ root, args: ["--minor"], dryRun: true, exec: fakeGit({ lastTag: "v0.5.0" }) });
    for (const manifest of MANIFESTS) assert.equal(await readManifestVersion(root, manifest), "0.5.0");
    assert.equal(await readHostVersion(root), "0.5.0");
  });

  it("refuses a version that already has a tag", async () => {
    await assert.rejects(prepareRelease({ root, args: ["0.6.0"], exec: fakeGit({ tags: new Set(["v0.6.0"]) }) }), /already exists/);
    assert.equal(await readManifestVersion(root, "package.json"), "0.5.0");
  });

  it("refuses to run against an already inconsistent tree", async () => {
    await writeFile(join(root, HOST_SOURCE), 'export const HOST_VERSION = "0.4.0" as const;\n', "utf8");
    await assert.rejects(prepareRelease({ root, args: ["0.6.0"], exec: fakeGit() }), /disagrees/);
  });

  it("still works when the repository has no tags yet", async () => {
    const result = await prepareRelease({ root, args: ["0.6.0"], exec: fakeGit() });
    assert.equal(result.tag, undefined);
    assert.deepEqual(result.commits, []);
  });

  it("leaves the tree readable by the version guard", async () => {
    await prepareRelease({ root, args: ["0.6.0"], exec: fakeGit() });
    const contents = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    assert.equal(contents.version, "0.6.0");
  });
});
