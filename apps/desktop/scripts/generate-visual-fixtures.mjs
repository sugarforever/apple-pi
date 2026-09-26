import { spawn } from "node:child_process";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

function referenceFilename(fixture, viewport) {
  return `${fixture.replaceAll("/", "-")}--${viewport.width}x${viewport.height}.png`;
}

function capturePlan(manifest) {
  return manifest.fixtures.flatMap((fixture) => manifest.viewports.map((viewport) => ({ fixture, viewport, filename: referenceFilename(fixture, viewport) })));
}

function pngDimensions(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Visual fixture capture failed (${signal ?? `exit ${code}`})`));
    });
  });
}

async function requireCaptures(plan, outputDirectory) {
  await Promise.all(
    plan.map(async ({ filename, viewport }) => {
      const image = await readFile(join(outputDirectory, filename)).catch(() => {
        throw new Error(`Visual fixture was not written: ${filename}`);
      });
      const dimensions = pngDimensions(image);
      if (dimensions.width !== viewport.width || dimensions.height !== viewport.height) {
        throw new Error(`Visual fixture ${filename}: expected ${viewport.width}x${viewport.height}, received ${dimensions.width}x${dimensions.height}`);
      }
    }),
  );
}

async function generateVisualFixtures() {
  const manifest = JSON.parse(await readFile(join(scriptDirectory, "../src/renderer/visual-fixtures.json"), "utf8"));
  const outputDirectory = join(scriptDirectory, "../out/visual-fixtures");
  const rendererFile = join(scriptDirectory, "../out/renderer/index.html");
  const plan = capturePlan(manifest);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(plan.map(({ filename }) => unlink(join(outputDirectory, filename)).catch(() => undefined)));

  const { default: electron } = await import("electron");
  await run(electron, [join(scriptDirectory, "capture-visual-fixtures.mjs")], {
    ...process.env,
    APPLE_PI_VISUAL_CAPTURE_PLAN: JSON.stringify(plan),
    APPLE_PI_VISUAL_OUTPUT_DIR: outputDirectory,
    APPLE_PI_VISUAL_RENDERER_FILE: rendererFile,
  });
  await requireCaptures(plan, outputDirectory);
}

await generateVisualFixtures();
