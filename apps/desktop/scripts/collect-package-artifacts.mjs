import { createHash } from "node:crypto";
import { appendFile, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function collectPackageArtifacts({ releaseDir, outputRoot, version, osName, artifactOs, arch, requiredSuffixes }) {
  const prefix = `apple-pi-${version}-${artifactOs}-${arch}`;
  const available = new Set((await readdir(releaseDir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name));
  const files = requiredSuffixes.map((suffix) => `${prefix}${suffix}`).sort();
  const missing = files.filter((file) => !available.has(file));
  if (missing.length > 0) throw new Error(`Missing packaged artifacts: ${missing.join(", ")}`);

  const outputDir = path.join(outputRoot, `apple-pi-${version}-${osName}-${arch}`);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  for (const file of files) {
    const source = path.join(releaseDir, file);
    const destination = path.join(outputDir, file);
    await copyFile(source, destination);
    const digest = createHash("sha256")
      .update(await readFile(source))
      .digest("hex");
    await writeFile(`${destination}.sha256`, `${digest}  ${file}\n`);
  }
  return outputDir;
}

export async function writeGitHubOutputs(outputFile, outputs) {
  const records = Object.entries(outputs)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
  await appendFile(outputFile, `${records}\n`);
}

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const repositoryDir = path.resolve(path.dirname(scriptPath), "../../..");
  const desktopPackage = JSON.parse(await readFile(path.join(repositoryDir, "apps/desktop/package.json"), "utf8"));
  collectPackageArtifacts({
    releaseDir: path.join(repositoryDir, "apps/desktop/release"),
    outputRoot: path.join(repositoryDir, "artifacts"),
    version: desktopPackage.version,
    osName: requiredEnvironment("APPLE_PI_OS"),
    artifactOs: requiredEnvironment("APPLE_PI_BUILDER_OS"),
    arch: requiredEnvironment("APPLE_PI_ARCH"),
    requiredSuffixes: requiredEnvironment("APPLE_PI_REQUIRED_SUFFIXES").split(","),
  })
    .then(async (outputDir) => {
      if (process.env.GITHUB_OUTPUT) {
        await writeGitHubOutputs(process.env.GITHUB_OUTPUT, {
          version: desktopPackage.version,
          artifact_path: outputDir,
        });
      }
      console.log(outputDir);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
