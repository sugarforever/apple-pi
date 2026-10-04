import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/*
 * Loaded on first use through `loadHighlighter` in highlight.ts, so the
 * highlighter and its grammars stay out of the startup bundle. The ids here
 * are the ones `languageOf` returns.
 */

const grammars = { bash, c, css, diff, dockerfile, go, ini, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml };
for (const [id, grammar] of Object.entries(grammars)) hljs.registerLanguage(id, grammar);

/** Highlighted HTML for `code`; highlight.js escapes the source text. */
export const highlight = (code: string, language: string): string => hljs.highlight(code, { language, ignoreIllegals: true }).value;
