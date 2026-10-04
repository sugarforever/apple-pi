import { contextBridge, ipcRenderer } from "electron";
import type { AppCommand, ApplePiApi, PiSessionMessage } from "../shared/pi-api.js";

/** The thin-client surface over Pi's RPC mode. Main owns the matching `pi-ipc` handlers. */
const piApi: ApplePiApi = {
  workspaces: {
    pick: () => ipcRenderer.invoke("workspaces:pick"),
    list: () => ipcRenderer.invoke("workspaces:list"),
    remove: (path) => ipcRenderer.invoke("workspaces:remove", path),
  },
  sessions: {
    list: (workspace) => ipcRenderer.invoke("sessions:list", workspace),
  },
  pi: {
    open: (request) => ipcRenderer.invoke("pi:open", request),
    send: (sessionKey, command) => ipcRenderer.invoke("pi:send", sessionKey, command),
    respondUI: (sessionKey, response) => ipcRenderer.invoke("pi:respondUI", sessionKey, response),
    close: (sessionKey) => ipcRenderer.invoke("pi:close", sessionKey),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, message: PiSessionMessage) => listener(message);
      ipcRenderer.on("pi:event", handler);
      return () => ipcRenderer.removeListener("pi:event", handler);
    },
  },
  shell: {
    openSettingsFile: () => ipcRenderer.invoke("shell:openSettingsFile"),
    openTerminal: (workspace) => ipcRenderer.invoke("shell:openTerminal", workspace),
  },
  app: {
    onCommand: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, command: AppCommand) => listener(command);
      ipcRenderer.on("app:command", handler);
      return () => ipcRenderer.removeListener("app:command", handler);
    },
  },
};

contextBridge.exposeInMainWorld("applePi", piApi);
