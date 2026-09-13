import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const hostPath = path.resolve(process.cwd(), "out/agent-host/index.js");

it.runIf(existsSync(hostPath))("starts and gracefully shuts down the packaged agent host", async () => {
  const child = spawn(process.execPath, [hostPath], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });

  child.stdin.write(`${JSON.stringify({ protocolVersion: 1, requestId: "hello", type: "system.hello", payload: {} })}\n`);
  await waitForLine(() => stdout, "hello");
  child.stdin.write(`${JSON.stringify({ protocolVersion: 1, requestId: "shutdown", type: "system.shutdown", payload: {} })}\n`);
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));

  expect(exitCode, stderr).toBe(0);
  expect(stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({ requestId: "hello", ok: true }),
    { protocolVersion: 1, requestId: "shutdown", ok: true, result: {} },
  ]);
}, 10_000);

async function waitForLine(read: () => string, requestId: string): Promise<void> {
  await expect.poll(() => read().split("\n").some((line) => line.includes(`"requestId":"${requestId}"`)), { timeout: 5_000 }).toBe(true);
}
