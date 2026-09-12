import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { encodeRecord, JsonlDecoder, type HostResponse } from "@apple-pi/protocol";
import { validateHostHandshake } from "./host-compatibility.js";

export interface AgentHostSupervisorOptions {
  hostPath: () => string;
  hostVersion: () => string;
  spawnHost?: (hostPath: string) => ChildProcessWithoutNullStreams;
}

export class AgentHostSupervisor extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private ready = false;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private readonly options: AgentHostSupervisorOptions) { super(); }

  async start(): Promise<void> {
    this.ready = false;
    const hostPath = this.options.hostPath();
    this.child = this.options.spawnHost?.(hostPath)
      ?? spawn(process.execPath, [hostPath], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
    const decoder = new JsonlDecoder();
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      for (const record of decoder.push(chunk)) this.onRecord(record);
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => console.error(`[agent-host] ${chunk.trimEnd()}`));
    this.child.once("exit", () => {
      this.ready = false;
      this.child = undefined;
      const error = new Error("Agent host stopped");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.emit("disconnected");
    });
    try {
      validateHostHandshake(await this.sendRequest("system.hello", {}), this.options.hostVersion());
      this.ready = true;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  request(type: string, payload: Record<string, unknown>): Promise<unknown> {
    if (!this.ready) return Promise.reject(new Error("Agent host handshake is not complete"));
    return this.sendRequest(type, payload);
  }

  private sendRequest(type: string, payload: Record<string, unknown>): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error("Agent host is not running"));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.child!.stdin.write(encodeRecord({ protocolVersion: 1, requestId, type, payload }));
    });
  }

  stop(): void { this.ready = false; this.child?.kill(); this.child = undefined; }

  private onRecord(record: unknown): void {
    if ((record as { type?: unknown })?.type === "session.event") { this.emit("session.event", record); return; }
    const response = record as HostResponse;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    response.ok ? pending.resolve(response.result) : pending.reject(new Error(response.error));
  }
}
