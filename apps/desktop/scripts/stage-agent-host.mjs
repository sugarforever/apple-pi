import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REQUIRED_AGENT_HOST_FILES = ["host-process.js", "index.js", "server.js"];

export async function stageAgentHost({ sourceDir, destinationDir }) {
  for (const file of REQUIRED_AGENT_HOST_FILES) {
    try {
      const source = await stat(path.join(sourceDir, file));
      if (!source.isFile()) throw new Error("not a file");
    } catch {
      throw new Error(`Required agent-host file is missing: ${file}`);
    }
  }

  await rm(destinationDir, { recursive: true, force: true });
  await mkdir(destinationDir, { recursive: true });
  await Promise.all(REQUIRED_AGENT_HOST_FILES.map((file) => (
    copyFile(path.join(sourceDir, file), path.join(destinationDir, file))
  )));
  return [...REQUIRED_AGENT_HOST_FILES];
}

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const desktopDir = path.resolve(path.dirname(scriptPath), "..");
  stageAgentHost({
    sourceDir: path.resolve(desktopDir, "../agent-host/dist"),
    destinationDir: path.resolve(desktopDir, "out/agent-host"),
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
