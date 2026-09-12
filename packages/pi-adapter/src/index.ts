import { createAgentSession, ModelRuntime, SessionManager, type AgentSession, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { decodeSessionSnapshot, type ApplePiSessionEvent, type ModelItem, type SessionItem, type SessionSnapshot } from "@apple-pi/protocol";
import { mapPiEvent, mapPiMessages, mapPiModel, mapPiSessionItem } from "./mappers.js";

export type PiEventListener = (event: ApplePiSessionEvent) => void;

export class PiSessionService {
  private session?: AgentSession;
  private unsubscribe?: () => void;
  private listener?: PiEventListener;
  private runtime?: ModelRuntime;

  onEvent(listener: PiEventListener): void { this.listener = listener; }

  private async getRuntime(): Promise<ModelRuntime> { return this.runtime ??= await ModelRuntime.create(); }

  async listSessions(cwd: string): Promise<SessionItem[]> {
    return (await SessionManager.list(cwd)).map(mapPiSessionItem);
  }

  async listModels(): Promise<ModelItem[]> {
    const models = (await this.getRuntime()).getAvailableSnapshot();
    return models.map(mapPiModel).sort((a, b) => `${a.provider}/${a.name}`.localeCompare(`${b.provider}/${b.name}`));
  }

  async open(cwd: string, sessionPath?: string, modelRef?: { provider?: string; modelId?: string }, createNew = false): Promise<SessionSnapshot> {
    this.unsubscribe?.();
    const recent = createNew ? [] : await SessionManager.list(cwd);
    const selectedPath = sessionPath ?? recent[0]?.path;
    const manager = selectedPath ? SessionManager.open(selectedPath, undefined, cwd) : SessionManager.create(cwd);
    const runtime = await this.getRuntime();
    const model = modelRef?.provider && modelRef.modelId ? runtime.getModel(modelRef.provider, modelRef.modelId) : undefined;
    const result = await createAgentSession({ cwd, sessionManager: manager, modelRuntime: runtime, ...(model ? { model } : {}) });
    this.session = result.session;
    this.unsubscribe = this.session.subscribe((event: AgentSessionEvent) => this.listener?.(mapPiEvent(event)));
    return this.snapshot();
  }

  async send(text: string): Promise<void> {
    if (!this.session) throw new Error("Open a workspace first");
    await this.session.prompt(text);
  }

  async cancel(): Promise<void> { await this.session?.abort(); }

  async setModel(provider: string, modelId: string): Promise<SessionSnapshot> {
    if (!this.session) throw new Error("Open a session first");
    const model = (await this.getRuntime()).getModel(provider, modelId);
    if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
    await this.session.setModel(model);
    return this.snapshot();
  }

  snapshot(): SessionSnapshot {
    if (!this.session) return decodeSessionSnapshot({ opened: false, messages: [], running: false });
    return decodeSessionSnapshot({
      opened: true,
      sessionId: this.session.sessionId,
      sessionFile: this.session.sessionFile,
      messages: mapPiMessages(this.session.messages),
      running: this.session.isStreaming,
      model: this.session.model ? mapPiModel(this.session.model) : undefined,
    });
  }

  async close(): Promise<void> { this.unsubscribe?.(); await this.session?.abort(); }
}
