import type {
  CustomProviderDefinition,
  HostEvent,
  ModelCatalogRefreshResult,
  ModelItem as ProtocolModelItem,
  ProviderItem,
  ProviderOperationResult,
  SessionItem as ProtocolSessionItem,
  SessionSnapshot,
  SkillCatalog,
  SkillOperationResult,
  SkillScope,
} from "@apple-pi/protocol";
declare global {
  interface Window {
    applePi: {
      system: { getVersion(): Promise<string> };
      workspace: { pick(): Promise<WorkspaceOpenResult | null>; list(): Promise<Catalog>; select(path: string): Promise<WorkspaceOpenResult> };
      session: {
        send(text: string): Promise<SessionSnapshot>;
        cancel(): Promise<SessionSnapshot>;
        getSnapshot(): Promise<SessionSnapshot>;
        list(): Promise<SessionItem[]>;
        select(path: string): Promise<SessionSnapshot>;
        create(): Promise<SessionSnapshot>;
        subscribe(listener: (event: HostEvent) => void): () => void;
      };
      model: {
        list(): Promise<ModelItem[]>;
        setSession(model: ModelRef): Promise<SessionSnapshot>;
        setDefault(model: ModelRef): Promise<Catalog>;
        clearDefault(): Promise<Catalog>;
      };
      provider: {
        list(): Promise<ProviderItem[]>;
        connectApiKey(providerId: string, apiKey: string, options?: ProviderOperationOptions): Promise<ProviderOperationResult>;
        disconnect(providerId: string, options?: ProviderOperationOptions): Promise<ProviderOperationResult>;
        verify(providerId: string, options?: ProviderOperationOptions): Promise<ProviderOperationResult>;
        refreshModels(providerIds?: string[], options?: ProviderOperationOptions): Promise<ModelCatalogRefreshResult>;
        startOAuthLogin(providerId: string, options?: ProviderOperationOptions): { operationId: string; result: Promise<ProviderOperationResult> };
        respondOAuthPrompt(operationId: string, promptId: string, value: string): Promise<{ accepted: boolean }>;
        listCustom(): Promise<CustomProviderDefinition[]>;
        addCustom(definition: CustomProviderDefinition, options?: ProviderOperationOptions): Promise<ProviderOperationResult>;
        updateCustom(id: string, definition: CustomProviderDefinition, options?: ProviderOperationOptions): Promise<ProviderOperationResult>;
        removeCustom(id: string, options?: ProviderOperationOptions): Promise<ProviderOperationResult>;
        subscribeAuthEvent(listener: (event: HostEvent) => void): () => void;
      };
      operation: { cancel(operationId: string): Promise<{ cancelled: boolean }> };
      skill: {
        list(): Promise<SkillCatalog>;
        install(scope: SkillScope, sourcePath: string): Promise<SkillOperationResult>;
        setEnabled(name: string, scope: SkillScope, enabled: boolean): Promise<SkillOperationResult>;
        remove(name: string, scope: SkillScope): Promise<SkillOperationResult>;
      };
    };
  }
}
export interface ProviderOperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface ModelRef {
  provider: string;
  modelId: string;
}
export type ModelItem = ProtocolModelItem;
export type SessionItem = ProtocolSessionItem;
export interface Catalog {
  workspaces: Array<{ path: string; name: string }>;
  defaultModel?: ModelRef;
}
export interface WorkspaceOpenResult {
  catalog?: Catalog;
  workspacePath: string;
  sessions: SessionItem[];
  session: SessionSnapshot;
}
export {};
