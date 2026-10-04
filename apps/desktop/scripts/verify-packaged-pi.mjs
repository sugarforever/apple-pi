// Spawns the bundled Pi the way the packaged app does: the app's own executable
// in Node mode, against Pi's rpc-entry inside app.asar. Pi gets a scratch agent
// dir and workspace so the check ignores the machine's Pi config.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RESPONSE_TIMEOUT_MS = 30_000;
const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(desktopDir, "release");
const piPackage = "@earendil-works/pi-coding-agent";

async function findAppArchives(directory) {
  const archives = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.name.endsWith(".unpacked")) archives.push(...(await findAppArchives(entryPath)));
    else if (entry.isFile() && entry.name === "app.asar") archives.push(entryPath);
  }
  return archives;
}

/** The executable the app spawns Pi with, per electron-builder's layouts (the Helper on macOS, see piExecutable). */
async function findExecutable(archivePath) {
  const resourcesDir = path.dirname(archivePath);
  if (process.platform === "darwin") {
    const macosDir = path.join(resourcesDir, "..", "MacOS");
    const [name, ...rest] = await readdir(macosDir);
    if (!name || rest.length) throw new Error(`Expected one executable in ${macosDir}`);
    return path.join(resourcesDir, "..", "Frameworks", `${name} Helper.app`, "Contents", "MacOS", `${name} Helper`);
  }
  const appDir = path.dirname(resourcesDir);
  const candidates = [];
  for (const name of await readdir(appDir)) {
    const info = await stat(path.join(appDir, name));
    if (!info.isFile()) continue;
    if (process.platform === "win32" ? name.endsWith(".exe") : (info.mode & 0o111) !== 0 && !name.includes(".") && !name.startsWith("chrome"))
      candidates.push(name);
  }
  if (candidates.length !== 1) throw new Error(`Expected one app executable in ${appDir}, found: ${candidates.join(", ") || "none"}`);
  return path.join(appDir, candidates[0]);
}

/** The packaged rpc-entry, located by the same export the app resolves. */
async function packagedRpcEntry(archivePath) {
  const manifest = JSON.parse(await readFile(path.join(desktopDir, "node_modules", piPackage, "package.json"), "utf8"));
  const entry = manifest.exports?.["./rpc-entry"]?.import;
  if (typeof entry !== "string") throw new Error(`${piPackage} no longer exports ./rpc-entry`);
  return path.join(archivePath, "node_modules", piPackage, entry);
}

const archives = await findAppArchives(releaseDir);
if (archives.length !== 1) throw new Error(`Expected one packaged app.asar under ${releaseDir}, found ${archives.length}`);
const executable = await findExecutable(archives[0]);
const entry = await packagedRpcEntry(archives[0]);

const scratchDir = await mkdtemp(path.join(os.tmpdir(), "apple-pi-packaged-pi-"));
const child = spawn(executable, [entry], {
  cwd: scratchDir,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PI_CODING_AGENT_DIR: path.join(scratchDir, "agent") },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
const exited = new Promise((resolve) => child.once("exit", resolve));

try {
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Packaged Pi did not answer get_state within ${RESPONSE_TIMEOUT_MS}ms: ${stderr}`)), RESPONSE_TIMEOUT_MS);
    let buffered = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop();
      const line = lines.find((candidate) => candidate.includes('"id":"smoke"'));
      if (!line) return;
      clearTimeout(timer);
      resolve(JSON.parse(line));
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Packaged Pi exited before responding (code ${String(code)}, signal ${String(signal)}): ${stderr}`));
    });
    child.stdin.write(`${JSON.stringify({ id: "smoke", type: "get_state" })}\n`);
  });
  if (response.type !== "response" || response.command !== "get_state" || response.success !== true) {
    throw new Error(`Unexpected get_state response: ${JSON.stringify(response)}`);
  }
  console.log(`Packaged Pi answered get_state: ${executable}`);
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await exited;
  await rm(scratchDir, { recursive: true, force: true });
}
