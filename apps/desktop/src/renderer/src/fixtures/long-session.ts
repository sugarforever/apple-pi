import type { AgentMessage, ToolCall } from "../pi/types.js";
import { assistant, text, thinking, toolCall, toolResult, user } from "./sample-messages.js";

/*
 * A long synthetic session for performance work: turns of thinking, large tool
 * outputs, file reads, edits with diffs, and long markdown answers. Content is
 * generated; nothing here comes from a real session.
 */

const topics = ["the retry helper", "the session index", "the settings loader", "the plugin registry", "the cache layer", "the log rotation"];
const files = ["src/session/retry.ts", "src/index/store.ts", "src/config/load.ts", "src/plugins/registry.ts", "src/cache/lru.ts", "src/log/rotate.ts"];

const sourceFile = (seed: number, lines: number): string =>
  Array.from({ length: lines }, (_, line) =>
    line % 12 === 0
      ? `/** Section ${line / 12} of module ${seed}: keeps the hot path allocation free. */`
      : `export const value${line} = compute(${seed}, ${line}, "item-${(seed * 31 + line) % 97}") ?? fallback(${line});`,
  ).join("\n");

const testLog = (seed: number, lines: number): string =>
  Array.from({ length: lines }, (_, line) => ` ✓ src/module-${seed}/case-${line}.test.ts (${(line * 7) % 40} tests) ${(line * 13) % 90}ms`).join("\n") +
  `\n\n Test Files  ${lines} passed (${lines})\n      Tests  ${lines * 12} passed`;

const editDiff = (seed: number): string =>
  [
    "    ...",
    ...Array.from({ length: 24 }, (_, i) => {
      const line = 40 + i;
      if (i % 6 === 2) return `-${line}   const previous${i} = legacy(${seed}, ${i});`;
      if (i % 6 === 3) return `+${line}   const next${i} = await modern(${seed}, ${i}, { signal });`;
      return ` ${line}   step(${seed}, ${i});`;
    }),
    "    ...",
  ].join("\n");

const answer = (turn: number, topic: string, file: string): string => `Done: ${topic} now handles the edge case from turn ${turn}, and the tests pass.

### What changed

1. \`${file}\` validates its input before touching the store.
2. Errors carry the original cause, so the log shows **why** a call failed.
3. The hot path no longer allocates per call; see the benchmark below.

| Case | Before | After |
| --- | --- | --- |
| cold start | ${120 + turn} ms | ${60 + turn} ms |
| warm call | ${14 + (turn % 5)} ms | ${3 + (turn % 3)} ms |

\`\`\`ts
export async function run${turn}(input: Input, { signal }: Options = {}): Promise<Result> {
  const checked = validate(input);
  if (!checked.ok) throw new InputError(checked.reason);
  return withRetry(() => store.write(checked.value), { attempts: 3, signal });
}
\`\`\`

To check it locally:

\`\`\`bash
pnpm test -- ${file.split("/").at(-1)}
\`\`\`

${"Follow-up worth considering: the same validation applies to the importer, and the old helper can go once nothing calls it. ".repeat(3)}`;

/** About `turns × 23` messages; 65 turns gives ~1,500. */
export function longSession(turns = 65, start = Date.UTC(2026, 8, 1, 9)): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let at = start;
  const tick = (seconds: number) => (at += seconds * 1000);
  for (let turn = 0; turn < turns; turn++) {
    const topic = topics[turn % topics.length]!;
    const file = files[turn % files.length]!;
    messages.push(user(`Turn ${turn + 1}: tighten ${topic} so it survives a cancelled request, then run the tests.`, tick(30)));
    for (let step = 0; step < 7; step++) {
      const id = `t${turn}-s${step}`;
      const read = toolCall(`${id}-read`, "read", { path: file });
      const calls: ToolCall[] =
        step % 3 === 0
          ? [read, toolCall(`${id}-grep`, "grep", { pattern: `use${step}`, path: "src" })]
          : step % 3 === 1
            ? [toolCall(`${id}-edit`, "edit", { path: file, edits: [] }), toolCall(`${id}-bash`, "bash", { command: `pnpm test -- module-${turn}` })]
            : [toolCall(`${id}-ls`, "bash", { command: "ls -la src" }), toolCall(`${id}-find`, "find", { pattern: "**/*.ts", path: "src" })];
      messages.push(
        assistant(
          [
            thinking(`Step ${step + 1}: check how ${topic} behaves when the signal aborts mid-write.\nThen confirm the callers.`),
            text(`Looking at ${file} next.`),
            ...calls,
          ],
          tick(5),
          "toolUse",
        ),
      );
      for (const call of calls) {
        const output =
          call.name === "read"
            ? sourceFile(turn * 10 + step, 220)
            : call.name === "bash"
              ? testLog(turn * 10 + step, 160)
              : Array.from({ length: 40 }, (_, i) => `src/module-${i}/file-${(turn + i) % 17}.ts:${i + 1}: use${step}(value)`).join("\n");
        const result = toolResult(call, output, tick(2));
        messages.push(
          call.name === "edit"
            ? {
                ...result,
                content: [{ type: "text", text: `Successfully replaced 3 blocks in ${file}.` }],
                details: { diff: editDiff(turn), patch: "", firstChangedLine: 42 },
              }
            : result,
        );
      }
    }
    messages.push(assistant([text(answer(turn + 1, topic, file))], tick(20)));
  }
  return messages;
}
