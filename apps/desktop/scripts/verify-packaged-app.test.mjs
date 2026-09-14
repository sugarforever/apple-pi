import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import asar from "@electron/asar";

import { verifyPackageArchive } from "./verify-packaged-app.mjs";

test("starts the agent host from an extracted application archive and verifies its handshake", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apple-pi-verify-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, "source");
  const hostDir = path.join(sourceDir, "out/agent-host");
  const archivePath = path.join(root, "app.asar");
  await mkdir(hostDir, { recursive: true });
  await writeFile(path.join(hostDir, "host-process.js"), "export {};\n");
  await writeFile(path.join(hostDir, "server.js"), "export {};\n");
  await writeFile(path.join(sourceDir, "package.json"), '{"type":"module"}\n');
  await writeFile(path.join(hostDir, "index.js"), `
    import readline from "node:readline";
    readline.createInterface({ input: process.stdin }).on("line", (line) => {
      const message = JSON.parse(line);
      if (message.type === "system.hello") process.stdout.write(JSON.stringify({ protocolVersion: 1, requestId: message.requestId, ok: true, result: { protocolVersion: 1, hostVersion: "0.1.0", piVersion: "0.84.2", capabilities: { sessionEvents: true, modelSelection: true }, pid: process.pid } }) + "\\n");
      if (message.type === "system.shutdown") { process.stdout.write(JSON.stringify({ protocolVersion: 1, requestId: message.requestId, ok: true, result: {} }) + "\\n", () => process.exit(0)); }
    });
  `);
  await asar.createPackage(sourceDir, archivePath);

  const result = await verifyPackageArchive({ archivePath, expectedVersion: "0.1.0" });

  assert.equal(result.hostVersion, "0.1.0");
  assert.equal(result.piVersion, "0.84.2");
  assert.deepEqual(result.capabilities, { sessionEvents: true, modelSelection: true });
  assert.equal(typeof result.pid, "number");
});

test("fails promptly when the packaged host acknowledges shutdown without exiting", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apple-pi-verify-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, "source");
  const hostDir = path.join(sourceDir, "out/agent-host");
  const archivePath = path.join(root, "app.asar");
  await mkdir(hostDir, { recursive: true });
  await writeFile(path.join(hostDir, "host-process.js"), "export {};\n");
  await writeFile(path.join(hostDir, "server.js"), "export {};\n");
  await writeFile(path.join(sourceDir, "package.json"), '{"type":"module"}\n');
  await writeFile(path.join(hostDir, "index.js"), `
    import readline from "node:readline";
    readline.createInterface({ input: process.stdin }).on("line", (line) => {
      const message = JSON.parse(line);
      const result = message.type === "system.hello" ? { protocolVersion: 1, hostVersion: "0.1.0", piVersion: "0.84.2", capabilities: { sessionEvents: true, modelSelection: true }, pid: process.pid } : {};
      process.stdout.write(JSON.stringify({ protocolVersion: 1, requestId: message.requestId, ok: true, result }) + "\\n");
    });
  `);
  await asar.createPackage(sourceDir, archivePath);

  await assert.rejects(
    verifyPackageArchive({ archivePath, expectedVersion: "0.1.0", shutdownTimeoutMs: 50 }),
    /Packaged agent-host did not exit within 50ms/,
  );
});
