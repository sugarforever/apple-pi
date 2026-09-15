import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("applePi", {
  system: { getVersion: () => ipcRenderer.invoke("system:version") },
  workspace: {
    pick: () => ipcRenderer.invoke("workspace:pick"),
    list: () => ipcRenderer.invoke("workspace:list"),
    select: (path: string) => ipcRenderer.invoke("workspace:select", path),
  },
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
  model: {
    list: () => ipcRenderer.invoke("model:list"),
    setSession: (model: unknown) => ipcRenderer.invoke("model:setSession", model),
    setDefault: (model: unknown) => ipcRenderer.invoke("model:setDefault", model),
    clearDefault: () => ipcRenderer.invoke("model:clearDefault"),
  },
  provider: {
    list: () => ipcRenderer.invoke("provider:list"),
    connectApiKey: (providerId: string, apiKey: string, options?: ProviderOperationOptions) =>
      invokeOperation("provider:connectApiKey", { providerId, apiKey }, options),
    disconnect: (providerId: string, options?: ProviderOperationOptions) => invokeOperation("provider:disconnect", { providerId }, options),
    verify: (providerId: string, options?: ProviderOperationOptions) => invokeOperation("provider:verify", { providerId }, options),
    refreshModels: (providerIds?: string[], options?: ProviderOperationOptions) =>
      invokeOperation("model:refresh", { ...(providerIds ? { providerIds } : {}) }, options),
    // Unlike `invokeOperation`, this returns the generated operationId
    // immediately (not only once the login resolves): a login stays pending
    // through one or more prompt round trips, so the caller needs the id right
    // away to correlate `provider:authEvent` pushes and `respondOAuthPrompt`
    // calls to this specific operation while it is still running.
    startOAuthLogin: (providerId: string, options?: ProviderOperationOptions) => {
      const operationId = crypto.randomUUID();
      const cancel = () => {
        void ipcRenderer.invoke("operation:cancel", operationId);
      };
      const request = ipcRenderer.invoke("provider:startOAuthLogin", { providerId, operationId, timeoutMs: options?.timeoutMs ?? 20 * 60 * 1000 });
      if (options?.signal?.aborted) cancel();
      else options?.signal?.addEventListener("abort", cancel, { once: true });
      return { operationId, result: request.finally(() => options?.signal?.removeEventListener("abort", cancel)) };
    },
    respondOAuthPrompt: (operationId: string, promptId: string, value: string) =>
      ipcRenderer.invoke("provider:respondOAuthPrompt", { operationId, promptId, value }),
    listCustom: () => ipcRenderer.invoke("provider:listCustom"),
    addCustom: (definition: unknown, options?: ProviderOperationOptions) => invokeOperation("provider:addCustom", { definition }, options),
    updateCustom: (id: string, definition: unknown, options?: ProviderOperationOptions) =>
      invokeOperation("provider:updateCustom", { id, definition }, options),
    removeCustom: (id: string, options?: ProviderOperationOptions) => invokeOperation("provider:removeCustom", { id }, options),
    subscribeAuthEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on("provider:authEvent", handler);
      return () => ipcRenderer.removeListener("provider:authEvent", handler);
    },
  },
  operation: {
    cancel: (operationId: string) => ipcRenderer.invoke("operation:cancel", operationId),
  },
});

interface ProviderOperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

function invokeOperation(channel: string, payload: Record<string, unknown>, options: ProviderOperationOptions = {}): Promise<unknown> {
  const operationId = crypto.randomUUID();
  const cancel = () => {
    void ipcRenderer.invoke("operation:cancel", operationId);
  };
  const request = ipcRenderer.invoke(channel, { ...payload, operationId, timeoutMs: options.timeoutMs ?? 15_000 });
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener("abort", cancel, { once: true });
  return request.finally(() => options.signal?.removeEventListener("abort", cancel));
}
