import { describe, expect, it } from "vitest";
import { languageForPath, languageOf, loadHighlighter } from "./highlight.js";

describe("languageOf", () => {
  it("names a language from a fence or an extension, and nothing for unknown ones", () => {
    expect(languageOf("ts")).toEqual({ id: "typescript", name: "TypeScript" });
    expect(languageOf(" Bash ")?.id).toBe("bash");
    expect(languageOf("text")).toBeUndefined();
    expect(languageOf(undefined)).toBeUndefined();
  });

  it("detects a file's language from its path", () => {
    expect(languageForPath("src/app/main.tsx")?.id).toBe("typescript");
    expect(languageForPath("C:\\repo\\setup.py")?.id).toBe("python");
    expect(languageForPath("docker/Dockerfile")?.id).toBe("dockerfile");
    expect(languageForPath(".gitignore")).toBeUndefined();
    expect(languageForPath("LICENSE")).toBeUndefined();
  });

  it("loads a grammar for the languages it names", async () => {
    const { highlight } = await loadHighlighter();
    expect(highlight("const a = 1;", "typescript")).toContain('<span class="hljs-keyword">const</span>');
  });
});
