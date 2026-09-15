import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import hostPackage from "../../../agent-host/package.json" with { type: "json" };
import { validateHostHandshake } from "./host-compatibility.js";

const hostDirectory = path.resolve(process.cwd(), "out/agent-host");
const requiredHostFiles = ["host-process.js", "index.js", "server.js"];
const hostPath = path.join(hostDirectory, "index.js");

it("contains the agent-host layout and completes the compatibility handshake", async () => {
  await Promise.all(requiredHostFiles.map((file) => access(path.join(hostDirectory, file))));
  const child = spawn(process.execPath, [hostPath], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });

  child.stdin.write(`${JSON.stringify({ protocolVersion: 1, requestId: "hello", type: "system.hello", payload: {} })}\n`);
  await waitForLine(() => stdout, "hello");
  const hello = JSON.parse(stdout.split("\n").find((line) => line.includes('"requestId":"hello"'))!);
  expect(hello.ok, hello.error).toBe(true);
  expect(validateHostHandshake(hello.result, hostPackage.version)).toEqual(
    expect.objectContaining({
      protocolVersion: 1,
      hostVersion: hostPackage.version,
      capabilities: { sessionEvents: true, modelSelection: true, providerManagement: true, cancellableProviderOperations: true },
      pid: expect.any(Number),
    }),
  );
  child.stdin.write(`${JSON.stringify({ protocolVersion: 1, requestId: "shutdown", type: "system.shutdown", payload: {} })}\n`);
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));

  expect(exitCode, stderr).toBe(0);
  expect(
    stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  ).toContainEqual({ protocolVersion: 1, requestId: "shutdown", ok: true, result: {} });
}, 10_000);

async function waitForLine(read: () => string, requestId: string): Promise<void> {
  await expect
    .poll(
      () =>
        read()
          .split("\n")
          .some((line) => line.includes(`"requestId":"${requestId}"`)),
      { timeout: 5_000 },
    )
    .toBe(true);
}
