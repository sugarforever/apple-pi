import { app, BrowserWindow, crashReporter, dialog, ipcMain, nativeTheme, session, type IpcMainInvokeEvent } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppCatalog } from "./app-catalog.js";
import { installAppMenu } from "./app-menu.js";
import { installGracefulShutdown } from "./graceful-shutdown.js";
import { attachFileLogging, log } from "./logger.js";
import { registerPiIpc } from "./pi-ipc.js";
import { PiProcessPool } from "./pi-process.js";
import { applyProcessHardening, applySessionPolicy, applyWindowPolicy, assertTrustedSender } from "./security.js";
import { shellEnv } from "./shell-env.js";
import { startAutoUpdater, type AutoUpdateHandle } from "./updater.js";

// Must run before `app.whenReady()` resolves.
applyProcessHardening();

// Local dumps only: no crash report leaves the machine. Enabling remote crash
// reporting is a privacy decision that needs an explicit opt-in first.
crashReporter.start({ productName: "Apple Pi Lite", companyName: "Apple Pi Lite", uploadToServer: false, compress: true });

const dirname = path.dirname(fileURLToPath(import.meta.url));
const piProcesses = new PiProcessPool();
let mainWindow: BrowserWindow | undefined;
let updates: AutoUpdateHandle | undefined;

function handle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    assertTrustedSender(event, mainWindow);
    return handler(event, ...args);
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    // On macOS the renderer draws the title bar around inset traffic lights,
    // centred in its 44px row; elsewhere the system frame stays.
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 18, y: 15 } } : {}),
    // Matches --color-canvas so the window does not flash before the renderer paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1a1a1a" : "#ffffff",
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
  log.info("Apple Pi Lite starting", {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    logPath,
  });

  applySessionPolicy(session.defaultSession);
  // Started now so the login shell has usually answered before the first Pi spawn.
  void shellEnv();

  const catalogPath = path.join(app.getPath("userData"), "catalog.json");
  const catalog = new AppCatalog({
    read: () => readFile(catalogPath, "utf8").catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? "" : Promise.reject(error))),
    write: async (value) => {
      await mkdir(path.dirname(catalogPath), { recursive: true });
      await writeFile(catalogPath, value, "utf8");
    },
  });
  await catalog.load();
  registerPiIpc({ handle, getWindow: () => mainWindow, catalog, pool: piProcesses, spawnEnv: shellEnv });
  // With the window closed on macOS, any menu command reopens it, which starts a new chat.
  installAppMenu((command) => (mainWindow ? mainWindow.webContents.send("app:command", command) : createWindow()));
  createWindow();
  // Started after the window exists so a slow update check cannot delay it, and
  // so an update that is already downloaded is reported in a live session.
  updates = startAutoUpdater();
  log.info("Apple Pi Lite ready");
}

// Two app instances would mean two Pi writers on the same session file, so a
// second launch focuses the existing window instead.
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
      dialog.showErrorBox("Apple Pi Lite failed to start", error instanceof Error ? error.message : String(error));
      app.exit(1);
    });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

installGracefulShutdown(app, { stop: () => piProcesses.stopAll() });
// Downloads install on quit, which electron-updater arranges itself; this only
// releases the listeners and the pending check.
app.on("will-quit", () => updates?.dispose());

process.on("unhandledRejection", (reason) => log.error("unhandled promise rejection", { reason }));
process.on("uncaughtException", (error) => log.error("uncaught exception", { error }));
