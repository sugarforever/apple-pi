import type { EditToolDetails } from "../pi/types.js";

/** One line of an edit's diff; `gap` stands for unchanged lines Pi left out. */
export type DiffLine = { kind: "added" | "removed" | "context"; line: number; text: string } | { kind: "gap" };

export interface LineChanges {
  added: number;
  removed: number;
}

const kinds = { "+": "added", "-": "removed", " ": "context" } as const;

/**
 * Parses the display diff in Pi's edit details: `+12 text`, `-12 text`, and ` 12 text`
 * with padded line numbers, and ` ...` where unchanged lines were skipped.
 * Returns undefined for anything else, so the row falls back to its raw output.
 */
export function parseEditDiff(details: unknown): DiffLine[] | undefined {
  const diff = (details as Partial<EditToolDetails> | null | undefined)?.diff;
  if (typeof diff !== "string" || !diff) return undefined;
  const lines: DiffLine[] = [];
  for (const raw of diff.split("\n")) {
    const match = /^([+\- ]) *(\d*) (.*)$/s.exec(raw);
    if (!match) return undefined;
    const [, sign, line, text] = match as unknown as [string, keyof typeof kinds, string, string];
    if (line) lines.push({ kind: kinds[sign], line: Number(line), text });
    else if (sign === " " && text === "...") lines.push({ kind: "gap" });
    else return undefined;
  }
  // Leading and trailing gaps only say the file goes on; line numbers already show it.
  while (lines[0]?.kind === "gap") lines.shift();
  while (lines.at(-1)?.kind === "gap") lines.pop();
  return lines.length > 0 ? lines : undefined;
}

export function countChanges(lines: DiffLine[]): LineChanges {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "added") added++;
    else if (line.kind === "removed") removed++;
  }
  return { added, removed };
}

/** Lines in a file's text; a final newline does not start another line. */
export const lineCount = (text: string): number => (text ? text.replace(/\n$/, "").split("\n").length : 0);
