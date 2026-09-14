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
  provider: {
    list: () => ipcRenderer.invoke("provider:list"),
    connectApiKey: (providerId: string, apiKey: string, options?: ProviderOperationOptions) => invokeOperation("provider:connectApiKey", { providerId, apiKey }, options),
    disconnect: (providerId: string, options?: ProviderOperationOptions) => invokeOperation("provider:disconnect", { providerId }, options),
    verify: (providerId: string, options?: ProviderOperationOptions) => invokeOperation("provider:verify", { providerId }, options),
    refreshModels: (providerIds?: string[], options?: ProviderOperationOptions) => invokeOperation("model:refresh", { ...(providerIds ? { providerIds } : {}) }, options),
  },
});

interface ProviderOperationOptions { signal?: AbortSignal; timeoutMs?: number }

function invokeOperation(channel: string, payload: Record<string, unknown>, options: ProviderOperationOptions = {}): Promise<unknown> {
  const operationId = crypto.randomUUID();
  const cancel = () => { void ipcRenderer.invoke("operation:cancel", operationId); };
  const request = ipcRenderer.invoke(channel, { ...payload, operationId, timeoutMs: options.timeoutMs ?? 15_000 });
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener("abort", cancel, { once: true });
  return request
    .finally(() => options.signal?.removeEventListener("abort", cancel));
}
