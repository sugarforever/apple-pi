import type { SessionSnapshot } from "./session-state.js";
declare global { interface Window { applePi: {
  system: { getVersion(): Promise<string> };
  workspace: { pick(): Promise<WorkspaceOpenResult | null>; list(): Promise<Catalog>; select(path: string): Promise<WorkspaceOpenResult> };
  session: { send(text: string): Promise<SessionSnapshot>; cancel(): Promise<SessionSnapshot>; getSnapshot(): Promise<SessionSnapshot>; list(): Promise<SessionItem[]>; select(path: string): Promise<SessionSnapshot>; create(): Promise<SessionSnapshot>; subscribe(listener: (event: { sequence: number; payload: unknown }) => void): () => void };
  model: { list(): Promise<ModelItem[]>; setSession(model: ModelRef): Promise<SessionSnapshot>; setDefault(model: ModelRef): Promise<Catalog> };
} } }
export interface ModelRef { provider: string; modelId: string }
export interface ModelItem extends ModelRef { name: string }
export interface SessionItem { id: string; path: string; name: string; modified: string; messageCount: number }
export interface Catalog { workspaces: Array<{ path: string; name: string }>; defaultModel?: ModelRef }
export interface WorkspaceOpenResult { catalog?: Catalog; workspacePath: string; sessions: SessionItem[]; session: SessionSnapshot }
export {};
