import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("applePi", {
  system: { getVersion: () => ipcRenderer.invoke("system:version") },
  workspace: { pick: () => ipcRenderer.invoke("workspace:pick"), list: () => ipcRenderer.invoke("workspace:list"), select: (path: string) => ipcRenderer.invoke("workspace:select", path) },
  session: {
    send: (text: string) => ipcRenderer.invoke("session:send", text),
    cancel: () => ipcRenderer.invoke("session:cancel"),
    getSnapshot: () => ipcRenderer.invoke("session:snapshot"),
    list: () => ipcRenderer.invoke("session:list"),
    select: (path: string) => ipcRenderer.invoke("session:select", path),
    create: () => ipcRenderer.invoke("session:create"),
    subscribe: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on("session:event", handler);
      return () => ipcRenderer.removeListener("session:event", handler);
    },
  },
  model: { list: () => ipcRenderer.invoke("model:list"), setSession: (model: unknown) => ipcRenderer.invoke("model:setSession", model), setDefault: (model: unknown) => ipcRenderer.invoke("model:setDefault", model) },
});
