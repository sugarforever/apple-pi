import { app, BrowserWindow, crashReporter, dialog, ipcMain, safeStorage, session, shell, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentHostSupervisor } from "./agent-host-supervisor.js";
import { AppCatalog, type ModelRef } from "./app-catalog.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { installGracefulShutdown } from "./graceful-shutdown.js";
import { CredentialBroker, CredentialFile } from "./credential-broker.js";
import { ProviderCredentialController } from "./provider-credential-controller.js";
import { attachFileLogging, log } from "./logger.js";
import { applyProcessHardening, applySessionPolicy, applyWindowPolicy } from "./security.js";
import { startAutoUpdater, type AutoUpdateHandle } from "./updater.js";
import type { CustomProviderDefinition, SessionSnapshot } from "@apple-pi/protocol";

// Must run before `app.whenReady()` resolves.
//
// Note what is deliberately absent: `--use-mock-keychain`. The credential
// broker below persists provider API keys through `safeStorage`, which is
// backed by the OS keychain. Chromium's mock keychain keeps
// `isEncryptionAvailable()` returning true while encrypting with a well-known
// key, so credentials would reach disk looking protected but readable by
// anything that can open the file. The macOS keychain prompt is therefore
// intentional behaviour, and stable code signing is what stops it from
// reappearing after every release.
applyProcessHardening();

// Local dumps only: no crash report leaves the machine. Enabling remote crash
// reporting is a privacy decision that needs an explicit opt-in first.
crashReporter.start({ productName: "Apple Pi", companyName: "Apple Pi", uploadToServer: false, compress: true });

const dirname = path.dirname(fileURLToPath(import.meta.url));
const host = new AgentHostSupervisor({
  hostPath: () => (app.isPackaged ? path.join(app.getAppPath(), "out", "agent-host", "index.js") : path.resolve(process.cwd(), "../agent-host/dist/index.js")),
  hostVersion: () => app.getVersion(),
});
let mainWindow: BrowserWindow | undefined;
let workspacePath: string | undefined;
let catalog: AppCatalog;
let credentials: CredentialBroker;
let providerCredentials: ProviderCredentialController;
let updates: AutoUpdateHandle | undefined;

/**
 * The renderer is the only legitimate caller of the IPC surface, and only from
 * its main frame. Anything else is rejected rather than answered.
 */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) throw new Error("Rejected IPC call from an untrusted sender");
  if (event.senderFrame && event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error("Rejected IPC call from a subframe");
}

function handle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#101213",
    show: false,
    webPreferences: {
      preload: path.join(dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  mainWindow = window;

  applyWindowPolicy(window, { devServerUrl: process.env.ELECTRON_RENDERER_URL, rendererRoot: path.join(dirname, "../renderer") });

  window.once("ready-to-show", () => window.show());
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    log.error("renderer failed to load", { errorCode, errorDescription, validatedUrl });
    // Never leave the user with an invisible window and no explanation.
    window.show();
  });
  window.on("closed", () => {
    mainWindow = undefined;
  });

  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(path.join(dirname, "../renderer/index.html"));
}

async function bootstrap(): Promise<void> {
  const logPath = attachFileLogging(app.getPath("logs"));
  log.info("Apple Pi starting", {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    logPath,
  });

  applySessionPolicy(session.defaultSession);

  const catalogPath = path.join(app.getPath("userData"), "catalog.json");
  catalog = new AppCatalog({
    read: () => readFile(catalogPath, "utf8").catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? "" : Promise.reject(error))),
    write: async (value) => {
      await mkdir(path.dirname(catalogPath), { recursive: true });
      await writeFile(catalogPath, value, "utf8");
    },
  });
  await catalog.load();
  credentials = new CredentialBroker(
    process.platform,
    {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value),
      selectedBackend: () => (process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : process.platform === "darwin" ? "keychain" : "dpapi"),
    },
    new CredentialFile(path.join(app.getPath("userData"), "credentials.json")),
  );
  await credentials.initialize();
  const storageIssue = credentials.storageIssue();
  if (storageIssue) log.warn("credential storage is degraded", { issue: storageIssue, persistence: credentials.storagePersistence() });
  else log.info("credential storage ready", { persistence: credentials.storagePersistence() });
  await host.start();
  providerCredentials = new ProviderCredentialController(credentials, host);
  host.on("session.event", (event) => mainWindow?.webContents.send("session:event", event));
  // The agent host is a plain Node process with no Electron APIs (see the
  // process boundary in `docs/architecture`), so opening the system browser for
  // an `auth_url` interaction step is Main's job, not `PiProviderService`'s.
  host.on("provider.authEvent", (event) => {
    if (event.payload.type === "auth_url")
      void shell.openExternal(event.payload.url).catch((error) => log.warn("failed to open system browser for sign-in", { error }));
    mainWindow?.webContents.send("provider:authEvent", event);
  });
  createWindow();
  // Started after the window exists so a slow update check cannot delay it, and
  // so an update that is already downloaded is reported in a live session.
  updates = startAutoUpdater();
  log.info("Apple Pi ready");
}

// pi sessions are JSONL files written by the agent host. Two app instances would
// mean two writers on the same session lease, so a second launch focuses the
// existing window instead of starting a competing agent host.
if (!app.requestSingleInstanceLock()) {
  log.info("another instance already holds the single-instance lock; exiting");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      log.error("failed to start", { error });
      dialog.showErrorBox("Apple Pi failed to start", error instanceof Error ? error.message : String(error));
      app.exit(1);
    });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

installGracefulShutdown(app, host);
// Downloads install on quit, which electron-updater arranges itself; this only
// releases the listeners and the pending check.
app.on("will-quit", () => updates?.dispose());

process.on("unhandledRejection", (reason) => log.error("unhandled promise rejection", { reason }));
process.on("uncaughtException", (error) => log.error("uncaught exception", { error }));

handle("workspace:pick", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  const chosenPath = await import("node:fs/promises").then(({ realpath }) => realpath(result.filePaths[0]!));
  workspacePath = chosenPath;
  await catalog.addWorkspace(chosenPath);
  const sessions = await host.request("session.list", { cwd: workspacePath });
  const defaultModel = await resolvedDefaultModel();
  if (defaultModel?.provider) await providerCredentials.provide(defaultModel.provider);
  const session = await host.request("session.create", { cwd: workspacePath, ...defaultModel });
  return { catalog: catalog.snapshot(), workspacePath, sessions, session };
});
handle("workspace:list", () => catalog.snapshot());
handle("workspace:select", async (_event, requestedPath: unknown) => {
  if (typeof requestedPath !== "string" || !catalog.snapshot().workspaces.some((item) => item.path === requestedPath)) throw new Error("Unknown workspace");
  workspacePath = requestedPath;
  const sessions = await host.request("session.list", { cwd: workspacePath });
  const list = sessions as Array<{ path: string }>;
  const session = list[0] ? await host.request("session.openPath", { cwd: workspacePath, path: list[0].path }) : await createSession();
  return { workspacePath, sessions, session };
});
handle("session:list", () => (workspacePath ? host.request("session.list", { cwd: workspacePath }) : []));
handle("session:select", (_event, sessionPath: unknown) => {
  if (!workspacePath || typeof sessionPath !== "string") throw new Error("Invalid session");
  return host.request("session.openPath", { cwd: workspacePath, path: sessionPath });
});
handle("session:create", () => {
  if (!workspacePath) throw new Error("Select a workspace first");
  return createSession();
});
handle("session:send", async (_event, text: unknown) => {
  if (!workspacePath || typeof text !== "string" || !text.trim()) throw new Error("Select a workspace and enter a message");
  const snapshot = await host.request("session.snapshot", {});
  if (snapshot.opened && snapshot.model?.provider) await providerCredentials.provide(snapshot.model.provider);
  return host.request("session.send", { text: text.trim() });
});
handle("session:cancel", () => host.request("session.cancel", {}));
handle("session:snapshot", () => host.request("session.snapshot", {}));
handle("system:version", () => app.getVersion());
handle("model:list", () => host.request("model.list", {}));
handle("provider:list", () => providerCredentials.list());
handle("provider:connectApiKey", async (_event, value: unknown) => {
  const input = providerOperation(value, true);
  return providerCredentials.connect({ ...input, apiKey: input.apiKey! });
});
handle("provider:disconnect", async (_event, value: unknown) => {
  const input = providerOperation(value);
  return providerCredentials.disconnect(input);
});
handle("provider:verify", async (_event, value: unknown) => {
  const input = providerOperation(value);
  return providerCredentials.verify(input);
});
handle("model:refresh", (_event, value: unknown) => {
  const input = operation(value);
  const providerIds = (value as { providerIds?: unknown }).providerIds;
  if (providerIds !== undefined && (!Array.isArray(providerIds) || providerIds.length === 0 || providerIds.some((id) => typeof id !== "string" || !id)))
    throw new Error("Invalid provider selection");
  return providerCredentials.refresh(providerIds as string[] | undefined, input);
});
handle("operation:cancel", (_event, operationId: unknown) => {
  if (typeof operationId !== "string" || !operationId) throw new Error("Invalid operation");
  return host.request("operation.cancel", { operationId });
});
handle("provider:startOAuthLogin", async (_event, value: unknown) => {
  const input = oauthLoginOperation(value);
  return providerCredentials.startOAuthLogin(input);
});
handle("provider:respondOAuthPrompt", async (_event, value: unknown) => {
  const input = oauthPromptResponse(value);
  return providerCredentials.respondOAuthPrompt(input);
});
handle("provider:listCustom", () => providerCredentials.listCustomProviders());
handle("provider:addCustom", async (_event, value: unknown) => {
  const input = customProviderAddOperation(value);
  return providerCredentials.addCustomProvider(input);
});
handle("provider:updateCustom", async (_event, value: unknown) => {
  const input = customProviderUpdateOperation(value);
  return providerCredentials.updateCustomProvider(input);
});
handle("provider:removeCustom", async (_event, value: unknown) => {
  const input = customProviderRemoveOperation(value);
  return providerCredentials.removeCustomProvider(input);
});

// Skill commands are simple pass-throughs (see `apps/desktop/src/preload/index.ts`):
// unlike the `provider.*` mutations above, their protocol payloads carry no
// `operationId`/`timeoutMs`, so there is nothing here to bound or cancel.
handle("skill:list", () => (workspacePath ? host.request("skill.list", { cwd: workspacePath }) : { skills: [], diagnostics: [] }));
handle("skill:install", (_event, value: unknown) => {
  if (!workspacePath) throw new Error("Select a workspace first");
  const { scope, sourcePath } = skillInstallInput(value);
  return host.request("skill.install", { cwd: workspacePath, scope, sourcePath });
});
handle("skill:setEnabled", (_event, value: unknown) => {
  if (!workspacePath) throw new Error("Select a workspace first");
  const { name, scope, enabled } = skillSetEnabledInput(value);
  return host.request("skill.setEnabled", { cwd: workspacePath, name, scope, enabled });
});
handle("skill:remove", (_event, value: unknown) => {
  if (!workspacePath) throw new Error("Select a workspace first");
  const { name, scope } = skillNameInput(value);
  return host.request("skill.remove", { cwd: workspacePath, name, scope });
});

function validModel(value: unknown): ModelRef {
  if (!value || typeof value !== "object" || typeof (value as ModelRef).provider !== "string" || typeof (value as ModelRef).modelId !== "string")
    throw new Error("Invalid model");
  return value as ModelRef;
}

handle("model:setSession", async (_event, value: unknown) => {
  const model = validModel(value);
  await providerCredentials.provide(model.provider);
  return host.request("model.set", { provider: model.provider, modelId: model.modelId });
});
handle("model:setDefault", async (_event, value: unknown) => {
  const model = validModel(value);
  await catalog.setDefaultModel(model);
  return catalog.snapshot();
});
handle("model:clearDefault", async () => {
  await catalog.clearDefaultModel();
  return catalog.snapshot();
});

function operation(value: unknown): { operationId: string; timeoutMs: number } {
  if (!value || typeof value !== "object") throw new Error("Invalid operation");
  const { operationId, timeoutMs } = value as { operationId?: unknown; timeoutMs?: unknown };
  if (typeof operationId !== "string" || !operationId || !Number.isInteger(timeoutMs) || (timeoutMs as number) < 100 || (timeoutMs as number) > 30_000)
    throw new Error("Invalid operation");
  return { operationId, timeoutMs: timeoutMs as number };
}

function providerOperation(value: unknown, withApiKey = false): { providerId: string; operationId: string; timeoutMs: number; apiKey?: string } {
  const base = operation(value);
  const { providerId, apiKey } = value as { providerId?: unknown; apiKey?: unknown };
  if (typeof providerId !== "string" || !providerId) throw new Error("Invalid provider");
  if (withApiKey && (typeof apiKey !== "string" || !apiKey)) throw new Error("Invalid API key");
  return { providerId, ...base, ...(withApiKey ? { apiKey: apiKey as string } : {}) };
}

function skillScope(value: unknown): "user" | "project" {
  if (value !== "user" && value !== "project") throw new Error("Invalid skill scope");
  return value;
}

function skillNameInput(value: unknown): { name: string; scope: "user" | "project" } {
  if (!value || typeof value !== "object") throw new Error("Invalid skill request");
  const { name, scope } = value as { name?: unknown; scope?: unknown };
  if (typeof name !== "string" || !name) throw new Error("Invalid skill name");
  return { name, scope: skillScope(scope) };
}

function skillInstallInput(value: unknown): { scope: "user" | "project"; sourcePath: string } {
  if (!value || typeof value !== "object") throw new Error("Invalid skill install request");
  const { scope, sourcePath } = value as { scope?: unknown; sourcePath?: unknown };
  if (typeof sourcePath !== "string" || !sourcePath) throw new Error("Invalid skill source path");
  return { scope: skillScope(scope), sourcePath };
}

function skillSetEnabledInput(value: unknown): { name: string; scope: "user" | "project"; enabled: boolean } {
  const base = skillNameInput(value);
  const { enabled } = (value ?? {}) as { enabled?: unknown };
  if (typeof enabled !== "boolean") throw new Error("Invalid skill enabled flag");
  return { ...base, enabled };
}

// An interactive OAuth login waits on the user, so it needs a much longer
// budget than `operation()`'s 30-second cap on every other bounded provider
// command; the ceiling matches `provider.startOAuthLogin`'s protocol schema.
function oauthLoginOperation(value: unknown): { providerId: string; operationId: string; timeoutMs: number } {
  if (!value || typeof value !== "object") throw new Error("Invalid operation");
  const { providerId, operationId, timeoutMs } = value as { providerId?: unknown; operationId?: unknown; timeoutMs?: unknown };
  if (typeof providerId !== "string" || !providerId) throw new Error("Invalid provider");
  if (typeof operationId !== "string" || !operationId || !Number.isInteger(timeoutMs) || (timeoutMs as number) < 100 || (timeoutMs as number) > 1_200_000)
    throw new Error("Invalid operation");
  return { providerId, operationId, timeoutMs: timeoutMs as number };
}

// A shallow IPC-boundary check only: the full shape (id charset, base URL, api
// type, model definitions) is enforced by the protocol schema once this crosses
// to the agent host (`decodeHostMessage`), matching `providerOperation()` above,
// which similarly defers rich validation to that same boundary.
function customProviderDefinitionInput(value: unknown): CustomProviderDefinition {
  if (!value || typeof value !== "object") throw new Error("Invalid provider definition");
  return value as CustomProviderDefinition;
}

function customProviderAddOperation(value: unknown): { definition: CustomProviderDefinition; operationId: string; timeoutMs: number } {
  const base = operation(value);
  const { definition } = value as { definition?: unknown };
  return { definition: customProviderDefinitionInput(definition), ...base };
}

function customProviderUpdateOperation(value: unknown): { id: string; definition: CustomProviderDefinition; operationId: string; timeoutMs: number } {
  const base = operation(value);
  const { id, definition } = value as { id?: unknown; definition?: unknown };
  if (typeof id !== "string" || !id) throw new Error("Invalid provider id");
  return { id, definition: customProviderDefinitionInput(definition), ...base };
}

function customProviderRemoveOperation(value: unknown): { id: string; operationId: string; timeoutMs: number } {
  const base = operation(value);
  const { id } = value as { id?: unknown };
  if (typeof id !== "string" || !id) throw new Error("Invalid provider id");
  return { id, ...base };
}

function oauthPromptResponse(value: unknown): { operationId: string; promptId: string; value: string } {
  if (!value || typeof value !== "object") throw new Error("Invalid operation");
  const { operationId, promptId, value: response } = value as { operationId?: unknown; promptId?: unknown; value?: unknown };
  if (typeof operationId !== "string" || !operationId) throw new Error("Invalid operation");
  if (typeof promptId !== "string" || !promptId) throw new Error("Invalid prompt");
  if (typeof response !== "string") throw new Error("Invalid response");
  return { operationId, promptId, value: response };
}

async function createSession(): Promise<SessionSnapshot> {
  if (!workspacePath) throw new Error("Select a workspace first");
  const defaultModel = await resolvedDefaultModel();
  if (defaultModel?.provider) await providerCredentials.provide(defaultModel.provider);
  return host.request("session.create", { cwd: workspacePath, ...defaultModel });
}

// The saved default model can outlive its provider (removed credential,
// disconnected provider). Clearing it here keeps `catalog.json` and every
// renderer that reads `workspace:list` in sync with what will actually be
// used, instead of quietly falling back to Pi's own default while Settings
// keeps showing a phantom selection.
async function resolvedDefaultModel(): Promise<ModelRef | undefined> {
  const requested = catalog.snapshot().defaultModel;
  const resolved = await providerCredentials.resolveDefaultModel(requested);
  if (requested && !resolved) await catalog.clearDefaultModel();
  return resolved;
}
