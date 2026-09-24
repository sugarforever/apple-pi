import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("sandbox preload package contract", () => {
  it("emits CommonJS without ESM imports", () => {
    const preload = path.resolve(process.cwd(), "out/preload/index.js");
    expect(existsSync(preload)).toBe(true);
    expect(readFileSync(preload, "utf8")).not.toMatch(/^import\s/m);
  });
});
