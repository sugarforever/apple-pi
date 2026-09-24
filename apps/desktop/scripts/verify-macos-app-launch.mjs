import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(desktopDir, "release");

if (process.platform !== "darwin") throw new Error("The macOS package launch smoke check must run on macOS");

async function findMacApps(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("mac")).map((entry) => path.join(directory, entry.name, "Apple Pi.app"));
}

const apps = await findMacApps(releaseDir);
if (apps.length !== 1) throw new Error(`Expected one unpacked macOS app in ${releaseDir}, found ${apps.length}`);

const profileDir = await mkdtemp(path.join(os.tmpdir(), "apple-pi-package-smoke-"));
const executable = path.join(apps[0], "Contents", "MacOS", "Apple Pi");
const child = spawn(executable, [`--user-data-dir=${profileDir}`], { stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
child.stderr.setEncoding("utf8").on("data", (chunk) => {
  stderr += chunk;
});

try {
  const result = await Promise.race([
    new Promise((resolve) => child.once("exit", (code, signal) => resolve({ exited: true, code, signal }))),
    new Promise((resolve) => setTimeout(() => resolve({ exited: false }), 2_000)),
  ]);
  if (result.exited) throw new Error(`Packaged macOS app exited during launch (code ${String(result.code)}, signal ${String(result.signal)}): ${stderr}`);
  console.log(`Packaged macOS app remained running through launch smoke: ${apps[0]}`);
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => (child.exitCode === null ? child.once("exit", resolve) : resolve())),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await new Promise((resolve) => (child.exitCode === null ? child.once("exit", resolve) : resolve()));
  await rm(profileDir, { recursive: true, force: true });
}
