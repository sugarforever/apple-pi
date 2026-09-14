import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import asar from "@electron/asar";

const REQUIRED_AGENT_HOST_FILES = ["host-process.js", "index.js", "server.js"];

export async function verifyPackageArchive({ archivePath, expectedVersion, shutdownTimeoutMs = 5_000 }) {
  const extractedDir = await mkdtemp(path.join(os.tmpdir(), "apple-pi-packaged-app-"));
  try {
    asar.extractAll(archivePath, extractedDir);
    const hostDir = path.join(extractedDir, "out/agent-host");
    await Promise.all(REQUIRED_AGENT_HOST_FILES.map((file) => readFile(path.join(hostDir, file))));
    return await exerciseHost(path.join(hostDir, "index.js"), expectedVersion, shutdownTimeoutMs);
  } finally {
    await rm(extractedDir, { recursive: true, force: true });
  }
}

async function exerciseHost(hostPath, expectedVersion, shutdownTimeoutMs) {
  const child = spawn(process.execPath, [hostPath], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  try {
    child.stdin.write(`${JSON.stringify({ protocolVersion: 1, requestId: "hello", type: "system.hello", payload: {} })}\n`);
    const hello = await waitForResponse(() => stdout, "hello");
    if (!hello.ok) throw new Error(`Packaged agent-host handshake failed: ${hello.error}`);
    const result = hello.result;
    if (result?.protocolVersion !== 1
      || result.hostVersion !== expectedVersion
      || typeof result.piVersion !== "string"
      || result.capabilities?.sessionEvents !== true
      || result.capabilities?.modelSelection !== true
      || typeof result.pid !== "number") {
      throw new Error(`Invalid packaged agent-host handshake: ${JSON.stringify(result)}`);
    }
    child.stdin.write(`${JSON.stringify({ protocolVersion: 1, requestId: "shutdown", type: "system.shutdown", payload: {} })}\n`);
    const shutdown = await waitForResponse(() => stdout, "shutdown");
    if (!shutdown.ok) throw new Error(`Packaged agent-host shutdown failed: ${shutdown.error}`);
    const exitCode = await waitForExit(child, shutdownTimeoutMs, stderr);
    if (exitCode !== 0) throw new Error(`Packaged agent-host exited with ${String(exitCode)}: ${stderr}`);
    return result;
  } finally {
    if (child.exitCode === null) child.kill();
  }
}

async function waitForResponse(read, requestId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const line = read().split("\n").find((candidate) => candidate.includes(`"requestId":"${requestId}"`));
    if (line) return JSON.parse(line);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for packaged agent-host response: ${requestId}`);
}

function waitForExit(child, timeoutMs, stderr) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(
      `Packaged agent-host did not exit within ${timeoutMs}ms${stderr ? `: ${stderr}` : ""}`,
    )), timeoutMs);
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
}

async function findAppArchives(directory) {
  const archives = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) archives.push(...await findAppArchives(entryPath));
    else if (entry.isFile() && entry.name === "app.asar") archives.push(entryPath);
  }
  return archives;
}

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const repositoryDir = path.resolve(path.dirname(scriptPath), "../../..");
  const desktopPackage = JSON.parse(await readFile(path.join(repositoryDir, "apps/desktop/package.json"), "utf8"));
  const archives = await findAppArchives(path.join(repositoryDir, "apps/desktop/release"));
  if (archives.length !== 1) {
    console.error(`Expected exactly one packaged app.asar, found ${archives.length}`);
    process.exitCode = 1;
  } else {
    verifyPackageArchive({ archivePath: archives[0], expectedVersion: desktopPackage.version })
      .then(() => console.log(`Verified packaged agent-host handshake: ${archives[0]}`))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
