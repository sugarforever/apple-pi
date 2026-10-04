import { useEffect, useState } from "react";

export interface Language {
  /** The grammar id registered in highlighter.ts. */
  id: string;
  name: string;
}

const languages: Record<string, [name: string, aliases: string[]]> = {
  bash: ["Bash", ["sh", "shell", "zsh", "console"]],
  c: ["C", ["h"]],
  css: ["CSS", []],
  diff: ["Diff", ["patch"]],
  dockerfile: ["Dockerfile", ["docker"]],
  go: ["Go", ["golang"]],
  ini: ["TOML", ["toml", "cfg", "conf"]],
  java: ["Java", []],
  javascript: ["JavaScript", ["js", "jsx", "mjs", "cjs"]],
  json: ["JSON", ["jsonc", "json5"]],
  markdown: ["Markdown", ["md", "mdx"]],
  python: ["Python", ["py"]],
  rust: ["Rust", ["rs"]],
  sql: ["SQL", []],
  typescript: ["TypeScript", ["ts", "tsx", "mts", "cts"]],
  xml: ["HTML", ["html", "htm", "svg", "vue", "plist"]],
  yaml: ["YAML", ["yml"]],
};

const byAlias = new Map<string, Language>();
for (const [id, [name, aliases]] of Object.entries(languages)) for (const alias of [id, ...aliases]) byAlias.set(alias, { id, name });

/** The language a code fence's info string or a file extension names; undefined renders plain. */
export const languageOf = (name: string | undefined): Language | undefined => (name ? byAlias.get(name.trim().toLowerCase()) : undefined);

export function languageForPath(path: string): Language | undefined {
  const file = path.split(/[\\/]/).at(-1) ?? "";
  if (/^dockerfile$/i.test(file)) return languageOf("dockerfile");
  const dot = file.lastIndexOf(".");
  return dot > 0 ? languageOf(file.slice(dot + 1)) : undefined;
}

type Highlighter = typeof import("./highlighter.js");

let loaded: Highlighter | undefined;
let loading: Promise<Highlighter> | undefined;

export const loadHighlighter = (): Promise<Highlighter> => (loading ??= import("./highlighter.js").then((module) => (loaded = module)));

/** The highlighter once loaded; loads it on first use when `enabled`. Code renders plain until then. */
export function useHighlighter(enabled: boolean): Highlighter | undefined {
  const [highlighter, setHighlighter] = useState(loaded);
  useEffect(() => {
    if (!enabled || highlighter) return;
    let live = true;
    void loadHighlighter().then((module) => {
      if (live) setHighlighter(module);
    });
    return () => {
      live = false;
    };
  }, [enabled, highlighter]);
  return highlighter;
}
