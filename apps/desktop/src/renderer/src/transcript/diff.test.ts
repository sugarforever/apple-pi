import { describe, expect, it } from "vitest";
import { countChanges, lineCount, parseEditDiff } from "./diff.js";

// Pi's display diff: sign, line number padded to the widest, a space, the text.
const diff = ["    ...", "  9 const a = 1;", "-10 const b = 2;", "+10 const b = 3;", "+11 ", "    ...", " 40 export { a, b };", "    ..."].join("\n");

describe("parseEditDiff", () => {
  it("reads lines, numbers, and hunk gaps, dropping gaps at the ends", () => {
    const lines = parseEditDiff({ diff, patch: "", firstChangedLine: 10 });
    expect(lines).toEqual([
      { kind: "context", line: 9, text: "const a = 1;" },
      { kind: "removed", line: 10, text: "const b = 2;" },
      { kind: "added", line: 10, text: "const b = 3;" },
      { kind: "added", line: 11, text: "" },
      { kind: "gap" },
      { kind: "context", line: 40, text: "export { a, b };" },
    ]);
    expect(countChanges(lines!)).toEqual({ added: 2, removed: 1 });
  });

  it("rejects details that are not a display diff", () => {
    expect(parseEditDiff(undefined)).toBeUndefined();
    expect(parseEditDiff({})).toBeUndefined();
    expect(parseEditDiff({ diff: "@@ -1 +1 @@\n-a\n+b" })).toBeUndefined();
  });
});

describe("lineCount", () => {
  it("does not count a final newline as a line", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("one\ntwo\n")).toBe(2);
    expect(lineCount("one\ntwo")).toBe(2);
  });
});
