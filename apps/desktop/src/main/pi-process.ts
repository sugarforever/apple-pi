import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import type { RpcCommand, RpcExtensionUIResponse, RpcResponse } from "@earendil-works/pi-coding-agent";
import type { PiProcessEvent, PiProcessExit } from "../shared/pi-api.js";
import { createLogger } from "./logger.js";

export type { PiProcessEvent, PiProcessExit };

const log = createLogger("pi-process");

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 2_000;
const STDERR_TAIL_CHARS = 8_192;

export interface PiProcessOptions {
  /** Working directory Pi runs in. */
  workspace: string;
  /** Session file to resume; Pi starts a new session when omitted. */
  sessionFile?: string;
  requestTimeoutMs?: number;
  /** Script run under Electron's Node runtime. Defaults to the bundled Pi rpc-entry; tests pass a fake. */
  entryPath?: string;
}

/**
 * The bundled Pi RPC entry point. The package only exports it under the
 * `import` condition, so `require.resolve` cannot find it.
 */
export function resolvePiRpcEntry(): string {
  return fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
}

interface PendingRequest {
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * One `pi --mode rpc` child. Commands go out as JSON lines on stdin; responses
 * are matched back by `id` and everything else is emitted as an `event`.
 */
export class PiProcess extends EventEmitter<{ event: [PiProcessEvent]; exit: [PiProcessExit] }> {
  private child?: ChildProcessWithoutNullStreams;
  private exited?: Promise<void>;
  private readonly pending = new Map<string, PendingRequest>();
  private nextId = 0;
  private stderrTail = "";
  private agentRunning = false;

  constructor(private readonly options: PiProcessOptions) {
    super();
  }

  /** True when no command is in flight and the agent is not mid-run. */
  get idle(): boolean {
    return this.pending.size === 0 && !this.agentRunning;
  }

  start(): void {
    if (this.child) throw new Error("Pi process already started");
    const args = [this.options.entryPath ?? resolvePiRpcEntry()];
    if (this.options.sessionFile) args.push("--session", this.options.sessionFile);
    // Pi's rpc-entry adds `--mode rpc` itself. A process group of its own lets
    // stop() take down the tool commands Pi spawned along with it.
    const child = spawn(process.execPath, args, {
      cwd: this.options.workspace,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    this.child = child;

    let finished = false;
    let markExited!: () => void;
    this.exited = new Promise((resolve) => (markExited = resolve));
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (finished) return;
      finished = true;
      this.agentRunning = false;
      this.rejectPending(`Pi process exited (code ${code}, signal ${signal})`);
      markExited();
      this.emit("exit", { code, signal, stderr: this.stderrTail });
    };
    child.once("exit", finish);
    child.once("error", (error) => {
      log.error("pi process failed", { error });
      finish(null, null);
    });
    // A write after Pi exits raises EPIPE here; the exit path already reports it.
    child.stdin.on("error", (error) => log.warn("pi stdin error", { error }));

    const decoder = new StringDecoder("utf8");
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      // Split on LF only: JSON strings may legally contain U+2028/U+2029.
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line) this.onLine(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
    });
  }

  /**
   * Sends a command and resolves with Pi's response, including `success: false`
   * responses. Rejects only when Pi is not running, exits, or does not answer in time.
   */
  send(command: RpcCommand, timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS): Promise<RpcResponse> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.reject(new Error("Pi process is not running"));
    const id = `apple-pi-${++this.nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi did not answer ${command.type} within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  respondUI(response: RpcExtensionUIResponse): void {
    this.child?.stdin.write(`${JSON.stringify(response)}\n`);
  }

  /** Asks Pi to shut down, then kills the process group if it lingers. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child || !this.exited) return;
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.end();
      this.signal(child, "SIGTERM");
    }
    const timer = setTimeout(() => this.signal(child, "SIGKILL"), STOP_GRACE_MS);
    await this.exited;
    clearTimeout(timer);
  }

  private signal(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // Already gone.
    }
  }

  private onLine(line: string): void {
    let message: RpcResponse | PiProcessEvent;
    try {
      message = JSON.parse(line) as RpcResponse | PiProcessEvent;
    } catch {
      log.warn("ignoring unparseable pi output", { line: line.slice(0, 200) });
      return;
    }
    if (message.type === "response") {
      const pending = message.id ? this.pending.get(message.id) : undefined;
      if (!pending) {
        log.warn("ignoring unmatched pi response", { command: message.command, id: message.id });
        return;
      }
      this.pending.delete(message.id!);
      clearTimeout(pending.timer);
      pending.resolve(message);
      return;
    }
    if (message.type === "agent_start") this.agentRunning = true;
    else if (message.type === "agent_settled") this.agentRunning = false;
    this.emit("event", message);
  }

  private rejectPending(reason: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }
}

export interface PiProcessPoolOptions {
  /** Most live Pi processes at once. */
  cap?: number;
}

/**
 * Live Pi processes keyed by session. When the cap is reached, opening another
 * stops the least recently used idle process; its session file lets it resume later.
 */
export class PiProcessPool {
  // Map order doubles as recency order: oldest first.
  private readonly processes = new Map<string, PiProcess>();
  private readonly cap: number;

  constructor(options: PiProcessPoolOptions = {}) {
    this.cap = options.cap ?? 6;
  }

  /** Returns the live process for `key`, starting one if needed. */
  open(key: string, options: PiProcessOptions): PiProcess {
    const existing = this.get(key);
    if (existing) return existing;
    if (this.processes.size >= this.cap) this.evictIdle();
    const piProcess = new PiProcess(options);
    piProcess.once("exit", () => {
      if (this.processes.get(key) === piProcess) this.processes.delete(key);
    });
    piProcess.start();
    this.processes.set(key, piProcess);
    return piProcess;
  }

  /** Looks up a live process and marks it as most recently used. */
  get(key: string): PiProcess | undefined {
    const piProcess = this.processes.get(key);
    if (!piProcess) return undefined;
    this.processes.delete(key);
    this.processes.set(key, piProcess);
    return piProcess;
  }

  async close(key: string): Promise<void> {
    const piProcess = this.processes.get(key);
    this.processes.delete(key);
    await piProcess?.stop();
  }

  async stopAll(): Promise<void> {
    const all = [...this.processes.values()];
    this.processes.clear();
    await Promise.all(all.map((piProcess) => piProcess.stop()));
  }

  private evictIdle(): void {
    for (const [key, piProcess] of this.processes) {
      if (!piProcess.idle) continue;
      log.info("stopping idle pi process to stay under the cap", { key, cap: this.cap });
      // SIGTERM goes out synchronously, so even a quit right after this cannot orphan it.
      void this.close(key);
      return;
    }
    // Every process is busy. Going over the cap beats refusing to open a session.
    log.warn("all pi processes are busy; exceeding the cap", { cap: this.cap });
  }
}
