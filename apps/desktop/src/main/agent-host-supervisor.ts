import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { app } from "electron";
import { encodeRecord, JsonlDecoder, type HostResponse } from "@apple-pi/protocol";

export class AgentHostSupervisor extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  async start(): Promise<void> {
    const hostPath = app.isPackaged
      ? path.join(app.getAppPath(), "out", "agent-host", "index.js")
      : path.resolve(process.cwd(), "../agent-host/dist/index.js");
    this.child = spawn(process.execPath, [hostPath], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
    const decoder = new JsonlDecoder();
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      for (const record of decoder.push(chunk)) this.onRecord(record);
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => console.error(`[agent-host] ${chunk.trimEnd()}`));
    this.child.once("exit", () => {
      const error = new Error("Agent host stopped");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.emit("disconnected");
    });
    await this.request("system.hello", {});
  }

  request(type: string, payload: Record<string, unknown>): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error("Agent host is not running"));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.child!.stdin.write(encodeRecord({ protocolVersion: 1, requestId, type, payload }));
    });
  }

  stop(): void { this.child?.kill(); this.child = undefined; }

  private onRecord(record: unknown): void {
    if ((record as { type?: unknown })?.type === "session.event") { this.emit("session.event", record); return; }
    const response = record as HostResponse;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    response.ok ? pending.resolve(response.result) : pending.reject(new Error(response.error));
  }
}
