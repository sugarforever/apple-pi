import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { dialog, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { RpcCommand, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import type { PiOpenRequest, PiSessionMessage } from "../shared/pi-api.js";
import type { AppCatalog } from "./app-catalog.js";
import type { PiProcess, PiProcessPool } from "./pi-process.js";

const execFileAsync = promisify(execFile);

/** Commands whose answer waits on the work itself rather than a quick round trip. */
const LONG_COMMANDS = new Set<RpcCommand["type"]>(["bash", "compact", "export_html"]);
const LONG_COMMAND_TIMEOUT_MS = 30 * 60_000;

export interface PiIpcOptions {
  /** Registers an IPC handler that only answers the trusted renderer. */
  handle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
  getWindow(): BrowserWindow | undefined;
  catalog: AppCatalog;
  pool: PiProcessPool;
  /** Environment for new Pi processes, resolved once before the first spawn. */
  spawnEnv(): Promise<NodeJS.ProcessEnv>;
}

/**
 * The renderer's Pi channels (see `ApplePiApi`). Main checks only who is
 * calling and the rough shape of what they send; commands, responses, and
 * events pass through unchanged because Pi owns their meaning.
 */
export function registerPiIpc({ handle, getWindow, catalog, pool, spawnEnv }: PiIpcOptions): void {
  const knownWorkspace = (value: unknown): string => {
    if (typeof value !== "string" || !catalog.snapshot().workspaces.some((item) => item.path === value)) throw new Error("Unknown workspace");
    return value;
  };
  const openSession = (value: unknown): PiProcess => {
    const piProcess = typeof value === "string" ? pool.get(value) : undefined;
    if (!piProcess) throw new Error("Pi session is not open");
    return piProcess;
  };
  const push = (message: PiSessionMessage) => getWindow()?.webContents.send("pi:event", message);
  // A new session is keyed by a random id until Pi names its file. Remembering
  // the file once `get_state` reports it lets a later open of that file reach
  // the same process instead of starting a second writer.
  const keyByFile = new Map<string, string>();
  const forgetKey = (sessionKey: string) => {
    for (const [file, key] of keyByFile) if (key === sessionKey) keyByFile.delete(file);
  };
  const liveKeyFor = (sessionFile: string): string | undefined => {
    const key = keyByFile.get(sessionFile);
    return key && pool.get(key) ? key : undefined;
  };

  handle("workspaces:pick", async () => {
    const result = await dialog.showOpenDialog(getWindow()!, { properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    const workspace = await realpath(result.filePaths[0]);
    await catalog.addWorkspace(workspace);
    return catalog.snapshot().workspaces.find((item) => item.path === workspace) ?? null;
  });
  handle("workspaces:list", () => catalog.snapshot().workspaces);
  handle("workspaces:remove", async (_event, value: unknown) => {
    const workspace = knownWorkspace(value);
    await catalog.removeWorkspace(workspace);
    await pool.closeWorkspace(workspace);
  });

  // Importing Pi costs most of a second, so it waits until something needs it.
  handle("sessions:list", async (_event, workspace: unknown) => {
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    return SessionManager.list(knownWorkspace(workspace));
  });

  handle("pi:open", async (_event, value: unknown) => {
    const { workspace, sessionFile } = (value ?? {}) as Partial<PiOpenRequest>;
    const cwd = knownWorkspace(workspace);
    if (sessionFile !== undefined && (typeof sessionFile !== "string" || !path.isAbsolute(sessionFile))) throw new Error("Invalid session file");
    const env = await spawnEnv();
    // Nothing below awaits, so two opens of one file cannot both start a process.
    // A resumed session is keyed by its file, so one file never gets two Pi writers.
    const sessionKey = (sessionFile && liveKeyFor(sessionFile)) ?? sessionFile ?? randomUUID();
    if (pool.get(sessionKey)) return sessionKey;
    const piProcess = pool.open(sessionKey, { workspace: cwd, sessionFile, env });
    piProcess.on("event", (event) => push({ sessionKey, event }));
    piProcess.once("exit", (exited) => {
      forgetKey(sessionKey);
      push({ sessionKey, exited });
    });
    return sessionKey;
  });
  handle("pi:send", async (_event, sessionKey: unknown, command: unknown) => {
    if (!command || typeof command !== "object" || typeof (command as RpcCommand).type !== "string") throw new Error("Invalid Pi command");
    const { type } = command as RpcCommand;
    const response = await openSession(sessionKey).send(command as RpcCommand, LONG_COMMANDS.has(type) ? LONG_COMMAND_TIMEOUT_MS : undefined);
    if (response.success && response.command === "get_state" && response.data.sessionFile) {
      // The session may have moved to another file; only the current one maps here.
      forgetKey(sessionKey as string);
      keyByFile.set(response.data.sessionFile, sessionKey as string);
    }
    return response;
  });
  handle("pi:respondUI", (_event, sessionKey: unknown, response: unknown) => {
    const { type, id } = (response ?? {}) as Partial<RpcExtensionUIResponse>;
    if (type !== "extension_ui_response" || typeof id !== "string") throw new Error("Invalid extension UI response");
    openSession(sessionKey).respondUI(response as RpcExtensionUIResponse);
  });
  handle("pi:close", (_event, sessionKey: unknown) => {
    if (typeof sessionKey !== "string") throw new Error("Invalid session key");
    return pool.close(sessionKey);
  });

  handle("shell:openSettingsFile", () => openSettingsFile());
  handle("shell:openTerminal", (_event, workspace: unknown) => openTerminal(knownWorkspace(workspace)));
}

async function openSettingsFile(): Promise<void> {
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  const file = path.join(getAgentDir(), "settings.json");
  await mkdir(path.dirname(file), { recursive: true });
  // `wx` leaves an existing file alone; a new one starts as the empty object Pi accepts.
  await writeFile(file, "{}\n", { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const failure = await shell.openPath(file);
  if (failure) throw new Error(failure);
}

async function openTerminal(workspace: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("open", ["-a", "Terminal", workspace]);
    return;
  }
  // Best effort elsewhere: there is no single default terminal to ask for.
  const [command, args] = process.platform === "win32" ? ["cmd.exe", ["/c", "start", "cmd.exe"]] : ["x-terminal-emulator", []];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: workspace, detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
