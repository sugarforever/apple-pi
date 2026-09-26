import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { capturePlan, pngDimensions, referenceFilename } from "./generate-visual-fixtures.mjs";

const manifest = JSON.parse(await readFile(new URL("../src/renderer/visual-fixtures.json", import.meta.url), "utf8"));

test("visual fixture capture plan is the fixture and viewport cartesian product", () => {
  const plan = capturePlan(manifest);
  assert.equal(plan.length, manifest.fixtures.length * manifest.viewports.length);
  assert.deepEqual(plan[0], {
    fixture: manifest.fixtures[0],
    viewport: manifest.viewports[0],
    filename: referenceFilename(manifest.fixtures[0], manifest.viewports[0]),
  });
});

test("visual fixture filenames encode stable ids and exact dimensions", () => {
  assert.equal(referenceFilename("providers/failure", { width: 960, height: 640 }), "providers-failure--960x640.png");
});

test("PNG dimensions are read from the image header instead of trusted from the filename", () => {
  const header = Buffer.alloc(24);
  header.writeUInt32BE(960, 16);
  header.writeUInt32BE(640, 20);
  assert.deepEqual(pngDimensions(header), { width: 960, height: 640 });
});
