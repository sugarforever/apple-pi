import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { REQUIRED_AGENT_HOST_FILES, stageAgentHost } from "./stage-agent-host.mjs";

test("stages exactly the required agent-host files and removes stale output", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apple-pi-stage-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, "source");
  const destinationDir = path.join(root, "destination");
  await mkdir(sourceDir);
  await mkdir(destinationDir);
  await Promise.all(REQUIRED_AGENT_HOST_FILES.map((file) => writeFile(path.join(sourceDir, file), `// ${file}\n`)));
  await writeFile(path.join(destinationDir, "stale.js"), "// stale\n");

  const staged = await stageAgentHost({ sourceDir, destinationDir });

  assert.deepEqual(staged, ["host-process.js", "index.js", "server.js"]);
  assert.deepEqual(await readdir(destinationDir), ["host-process.js", "index.js", "server.js"]);
});

test("rejects staging when a required agent-host file is missing", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apple-pi-stage-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, "source");
  const destinationDir = path.join(root, "destination");
  await mkdir(sourceDir);
  await Promise.all(["index.js", "host-process.js"].map((file) => writeFile(path.join(sourceDir, file), `// ${file}\n`)));

  await assert.rejects(
    stageAgentHost({ sourceDir, destinationDir }),
    /Required agent-host file is missing: server\.js/,
  );
});
