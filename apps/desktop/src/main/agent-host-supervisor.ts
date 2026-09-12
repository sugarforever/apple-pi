import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  decodeHostRecord,
  encodeRecord,
  JsonlDecoder,
  type HostCommandPayloads,
  type HostCommandResults,
  type HostCommandType,
  type HostResponse,
} from "@apple-pi/protocol";
import { validateHostHandshake } from "./host-compatibility.js";

export interface AgentHostSupervisorOptions {
  hostPath: () => string;
  hostVersion: () => string;
  spawnHost?: (hostPath: string) => ChildProcessWithoutNullStreams;
}

export interface AgentHostProtocolFault {
  code: "INVALID_HOST_RECORD";
  message: string;
  requestId?: string;
}

export class AgentHostSupervisor extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private ready = false;
  private readonly pending = new Map<string, {
    type: HostCommandType;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  constructor(private readonly options: AgentHostSupervisorOptions) { super(); }

  async start(): Promise<void> {
    this.ready = false;
    const hostPath = this.options.hostPath();
    const child = this.options.spawnHost?.(hostPath)
      ?? spawn(process.execPath, [hostPath], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
    this.child = child;
    const decoder = new JsonlDecoder();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (this.child !== child) return;
      let records: unknown[];
      try {
        records = decoder.push(chunk);
      } catch {
        this.failProtocol(child);
        return;
      }
      for (const record of records) {
        if (this.child !== child) return;
        this.onRecord(child, record);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (this.child === child) console.error(`[agent-host] ${chunk.trimEnd()}`);
    });
    child.once("exit", () => {
      if (this.child !== child) return;
      this.ready = false;
      this.child = undefined;
      this.rejectPending(() => "Agent host stopped");
      this.emit("disconnected");
    });
    try {
      validateHostHandshake(await this.sendRequest("system.hello", {}), this.options.hostVersion());
      if (this.child !== child) throw new Error("Agent host stopped during handshake");
      this.ready = true;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  request<Command extends HostCommandType>(type: Command, payload: HostCommandPayloads[Command]): Promise<HostCommandResults[Command]> {
    if (!this.ready) return Promise.reject(new Error("Agent host handshake is not complete"));
    return this.sendRequest(type, payload);
  }

  private sendRequest<Command extends HostCommandType>(type: Command, payload: HostCommandPayloads[Command]): Promise<HostCommandResults[Command]> {
    if (!this.child) return Promise.reject(new Error("Agent host is not running"));
    const requestId = randomUUID();
    return new Promise<HostCommandResults[Command]>((resolve, reject) => {
      this.pending.set(requestId, { type, resolve: resolve as (value: unknown) => void, reject });
      this.child!.stdin.write(encodeRecord({ protocolVersion: 1, requestId, type, payload }));
    });
  }

  stop(): void {
    this.ready = false;
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    this.rejectPending(() => "Agent host stopped");
    child.kill();
    this.emit("disconnected");
  }

  private onRecord(child: ChildProcessWithoutNullStreams, record: unknown): void {
    const requestId = typeof (record as { requestId?: unknown })?.requestId === "string"
      ? (record as { requestId: string }).requestId
      : undefined;
    const pending = requestId ? this.pending.get(requestId) : undefined;
    let decoded;
    try {
      decoded = pending ? decodeHostRecord(record, pending.type) : decodeHostRecord(record);
    } catch {
      this.failProtocol(child, pending ? requestId : undefined);
      return;
    }
    if ("type" in decoded) { this.emit("session.event", decoded); return; }
    const response = decoded as HostResponse;
    const responsePending = this.pending.get(response.requestId);
    if (!responsePending) {
      this.failProtocol(child);
      return;
    }
    this.pending.delete(response.requestId);
    response.ok ? responsePending.resolve(response.result) : responsePending.reject(new Error(response.error));
  }

  private failProtocol(child: ChildProcessWithoutNullStreams, requestId?: string): void {
    if (this.child !== child) return;
    const message = requestId
      ? `Agent host protocol fault for request ${requestId}`
      : "Agent host protocol fault";
    const fault: AgentHostProtocolFault = {
      code: "INVALID_HOST_RECORD",
      message,
      ...(requestId ? { requestId } : {}),
    };
    this.ready = false;
    this.child = undefined;
    this.rejectPending((pendingId) => `Agent host protocol fault for request ${pendingId}`);
    child.kill();
    this.emit("protocol.fault", fault);
  }

  private rejectPending(message: (requestId: string) => string): void {
    const pendingRequests = [...this.pending.entries()];
    this.pending.clear();
    for (const [requestId, pending] of pendingRequests) pending.reject(new Error(message(requestId)));
  }
}
