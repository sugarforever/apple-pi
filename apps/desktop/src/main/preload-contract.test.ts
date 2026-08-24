import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

describe("sandbox preload build contract", () => {
  it("emits CommonJS without ESM imports", () => {
    const preload = path.resolve(process.cwd(), "out/preload/index.js");
    expect(existsSync(preload)).toBe(true);
    expect(readFileSync(preload, "utf8")).not.toMatch(/^import\s/m);
  });
});
