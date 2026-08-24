import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentHostSupervisor } from "./agent-host-supervisor.js";
import { AppCatalog, type ModelRef } from "./app-catalog.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const host = new AgentHostSupervisor();
let mainWindow: BrowserWindow | undefined;
let workspacePath: string | undefined;
let catalog: AppCatalog;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180, height: 800, minWidth: 760, minHeight: 560,
    titleBarStyle: "hiddenInset", backgroundColor: "#101213",
    webPreferences: { preload: path.join(dirname, "../preload/index.js"), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  mainWindow.webContents.on("will-navigate", (event, url) => { if (url !== mainWindow?.webContents.getURL()) { event.preventDefault(); openExternal(url); } });
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(path.join(dirname, "../renderer/index.html"));
}

function openExternal(value: string): void { try { const url = new URL(value); if (url.protocol === "https:") void shell.openExternal(url.href); } catch {} }

app.whenReady().then(async () => {
  const catalogPath = path.join(app.getPath("userData"), "catalog.json");
  catalog = new AppCatalog({
    read: () => readFile(catalogPath, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? "" : Promise.reject(error)),
    write: async (value) => { await mkdir(path.dirname(catalogPath), { recursive: true }); await writeFile(catalogPath, value, "utf8"); },
  });
  await catalog.load();
  await host.start();
  host.on("session.event", (event) => mainWindow?.webContents.send("session:event", event));
  createWindow();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on("before-quit", () => host.stop());

ipcMain.handle("workspace:pick", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  const chosenPath = await import("node:fs/promises").then(({ realpath }) => realpath(result.filePaths[0]!));
  workspacePath = chosenPath;
  await catalog.addWorkspace(chosenPath);
  const defaultModel = catalog.snapshot().defaultModel;
  const sessions = await host.request("session.list", { cwd: workspacePath });
  const session = await host.request("session.create", { cwd: workspacePath, ...defaultModel });
  return { catalog: catalog.snapshot(), workspacePath, sessions, session };
});
ipcMain.handle("workspace:list", () => catalog.snapshot());
ipcMain.handle("workspace:select", async (_event, requestedPath: unknown) => {
  if (typeof requestedPath !== "string" || !catalog.snapshot().workspaces.some((item) => item.path === requestedPath)) throw new Error("Unknown workspace");
  workspacePath = requestedPath;
  const sessions = await host.request("session.list", { cwd: workspacePath });
  const list = sessions as Array<{ path: string }>;
  const session = list[0] ? await host.request("session.openPath", { cwd: workspacePath, path: list[0].path }) : await host.request("session.create", { cwd: workspacePath, ...catalog.snapshot().defaultModel });
  return { workspacePath, sessions, session };
});
ipcMain.handle("session:list", () => workspacePath ? host.request("session.list", { cwd: workspacePath }) : []);
ipcMain.handle("session:select", (_event, sessionPath: unknown) => {
  if (!workspacePath || typeof sessionPath !== "string") throw new Error("Invalid session");
  return host.request("session.openPath", { cwd: workspacePath, path: sessionPath });
});
ipcMain.handle("session:create", () => {
  if (!workspacePath) throw new Error("Select a workspace first");
  return host.request("session.create", { cwd: workspacePath, ...catalog.snapshot().defaultModel });
});
ipcMain.handle("session:send", (_event, text: unknown) => {
  if (!workspacePath || typeof text !== "string" || !text.trim()) throw new Error("Select a workspace and enter a message");
  return host.request("session.send", { text: text.trim() });
});
ipcMain.handle("session:cancel", () => host.request("session.cancel", {}));
ipcMain.handle("session:snapshot", () => host.request("session.snapshot", {}));
ipcMain.handle("system:version", () => app.getVersion());
ipcMain.handle("model:list", () => host.request("model.list", {}));
function validModel(value: unknown): ModelRef {
  if (!value || typeof value !== "object" || typeof (value as ModelRef).provider !== "string" || typeof (value as ModelRef).modelId !== "string") throw new Error("Invalid model");
  return value as ModelRef;
}
ipcMain.handle("model:setSession", (_event, value: unknown) => { const model = validModel(value); return host.request("model.set", { provider: model.provider, modelId: model.modelId }); });
ipcMain.handle("model:setDefault", async (_event, value: unknown) => { const model = validModel(value); await catalog.setDefaultModel(model); return catalog.snapshot(); });
