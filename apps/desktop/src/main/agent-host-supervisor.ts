import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { log } from "./logger.js";
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
  shutdownTimeoutMs?: number;
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
  private stopping?: { child: ChildProcessWithoutNullStreams; promise: Promise<void> };
  private readonly exitWaiters = new WeakMap<ChildProcessWithoutNullStreams, () => void>();
  private readonly ignoredResponses = new Map<string, HostCommandType>();
  private readonly pending = new Map<string, {
    type: HostCommandType;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  constructor(private readonly options: AgentHostSupervisorOptions) { super(); }

  async start(): Promise<void> {
    if (this.stopping) await this.stopping.promise;
    if (this.child) await this.stop();
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
      // Host stderr can contain provider URLs and error text, so it goes through
      // the redacting logger rather than straight to the console.
      if (this.child === child) log.info("agent-host", { message: chunk.trimEnd() });
    });
    child.once("exit", () => {
      this.resolveExitWaiter(child);
      this.disconnect(child, "Agent host stopped");
    });
    try {
      validateHostHandshake(await this.sendRequest("system.hello", {}), this.options.hostVersion());
      if (this.child !== child) throw new Error("Agent host stopped during handshake");
      this.ready = true;
    } catch (error) {
      if (this.stopping?.child === child) await this.stopping.promise;
      else this.forceStop(child, "Agent host stopped");
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

  stop(): Promise<void> {
    if (this.stopping) return this.stopping.promise;
    this.ready = false;
    const child = this.child;
    if (!child) return Promise.resolve();
    this.rejectPending(() => "Agent host stopped", true);
    const operation = this.stopChild(child);
    const shared: Promise<void> = operation.finally(() => {
      if (this.stopping?.promise === shared) this.stopping = undefined;
    });
    this.stopping = { child, promise: shared };
    return shared;
  }

  private async stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    const exited = new Promise<void>((resolve) => this.exitWaiters.set(child, resolve));
    void this.sendRequest("system.shutdown", {}).catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.options.shutdownTimeoutMs ?? 1_000);
    });
    const exitedGracefully = await Promise.race([
      exited.then(() => true),
      timedOut.then(() => false),
    ]);
    if (timer) clearTimeout(timer);
    if (!exitedGracefully) {
      child.kill("SIGKILL");
      await exited;
    }
  }

  private onRecord(child: ChildProcessWithoutNullStreams, record: unknown): void {
    const requestId = typeof (record as { requestId?: unknown })?.requestId === "string"
      ? (record as { requestId: string }).requestId
      : undefined;
    const pending = requestId ? this.pending.get(requestId) : undefined;
    const ignoredType = requestId ? this.ignoredResponses.get(requestId) : undefined;
    let decoded;
    try {
      const expectedType = pending?.type ?? ignoredType;
      decoded = expectedType ? decodeHostRecord(record, expectedType) : decodeHostRecord(record);
    } catch {
      this.failProtocol(child, pending ? requestId : undefined);
      return;
    }
    if ("type" in decoded) { this.emit("session.event", decoded); return; }
    if (requestId && ignoredType) {
      this.ignoredResponses.delete(requestId);
      return;
    }
    const response = decoded as HostResponse;
    const responsePending = this.pending.get(response.requestId);
    if (!responsePending) {
      this.failProtocol(child);
      return;
    }
    this.pending.delete(response.requestId);
    if (response.ok) responsePending.resolve(response.result);
    else responsePending.reject(new Error(response.error));
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
    this.ignoredResponses.clear();
    child.kill();
    this.emit("protocol.fault", fault);
  }

  private forceStop(child: ChildProcessWithoutNullStreams, pendingMessage: string): void {
    if (this.child !== child) return;
    child.kill();
    this.disconnect(child, pendingMessage);
  }

  private disconnect(child: ChildProcessWithoutNullStreams, pendingMessage: string): void {
    if (this.child !== child) return;
    this.ready = false;
    this.child = undefined;
    this.rejectPending(() => pendingMessage);
    this.ignoredResponses.clear();
    this.emit("disconnected");
  }

  private resolveExitWaiter(child: ChildProcessWithoutNullStreams): void {
    const resolve = this.exitWaiters.get(child);
    this.exitWaiters.delete(child);
    resolve?.();
  }

  private rejectPending(message: (requestId: string) => string, ignoreResponses = false): void {
    const pendingRequests = [...this.pending.entries()];
    this.pending.clear();
    for (const [requestId, pending] of pendingRequests) {
      if (ignoreResponses) this.ignoredResponses.set(requestId, pending.type);
      pending.reject(new Error(message(requestId)));
    }
  }
}
