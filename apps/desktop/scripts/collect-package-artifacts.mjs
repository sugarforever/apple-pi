import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function collectPackageArtifacts({
  releaseDir,
  outputRoot,
  version,
  osName,
  artifactOs,
  arch,
  extensions,
}) {
  const prefix = `apple-pi-${version}-${artifactOs}-${arch}`;
  const allowedSuffixes = new Set(extensions.map((extension) => `.${extension.toLowerCase()}`));
  const files = (await readdir(releaseDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile()
      && entry.name.startsWith(prefix)
      && allowedSuffixes.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) throw new Error(`No packaged artifacts matched ${prefix}`);

  const outputDir = path.join(outputRoot, `apple-pi-${version}-${osName}-${arch}`);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  for (const file of files) {
    const source = path.join(releaseDir, file);
    const destination = path.join(outputDir, file);
    await copyFile(source, destination);
    const digest = createHash("sha256").update(await readFile(source)).digest("hex");
    await writeFile(`${destination}.sha256`, `${digest}  ${file}\n`);
  }
  return outputDir;
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
    extensions: requiredEnvironment("APPLE_PI_EXTENSIONS").split(","),
  }).then((outputDir) => console.log(outputDir)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
