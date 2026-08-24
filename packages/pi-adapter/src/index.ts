import { createAgentSession, ModelRuntime, SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";

export type PiEventListener = (event: unknown) => void;

export class PiSessionService {
  private session?: AgentSession;
  private unsubscribe?: () => void;
  private listener?: PiEventListener;
  private runtime?: ModelRuntime;

  onEvent(listener: PiEventListener): void { this.listener = listener; }

  private async getRuntime(): Promise<ModelRuntime> { return this.runtime ??= await ModelRuntime.create(); }

  async listSessions(cwd: string) {
    return (await SessionManager.list(cwd)).map((item) => ({ id: item.id, path: item.path, name: item.name || item.firstMessage || "New session", created: item.created.toISOString(), modified: item.modified.toISOString(), messageCount: item.messageCount }));
  }

  async listModels() {
    const models = (await this.getRuntime()).getAvailableSnapshot();
    return models.map((model) => ({ provider: model.provider, modelId: model.id, name: model.name || model.id })).sort((a, b) => `${a.provider}/${a.name}`.localeCompare(`${b.provider}/${b.name}`));
  }

  async open(cwd: string, sessionPath?: string, modelRef?: { provider?: string; modelId?: string }, createNew = false): Promise<ReturnType<PiSessionService["snapshot"]>> {
    this.unsubscribe?.();
    const recent = createNew ? [] : await SessionManager.list(cwd);
    const selectedPath = sessionPath ?? recent[0]?.path;
    const manager = selectedPath ? SessionManager.open(selectedPath, undefined, cwd) : SessionManager.create(cwd);
    const runtime = await this.getRuntime();
    const model = modelRef?.provider && modelRef.modelId ? runtime.getModel(modelRef.provider, modelRef.modelId) : undefined;
    const result = await createAgentSession({ cwd, sessionManager: manager, modelRuntime: runtime, ...(model ? { model } : {}) });
    this.session = result.session;
    this.unsubscribe = this.session.subscribe((event) => this.listener?.(toSerializable(event)));
    return this.snapshot();
  }

  async send(text: string): Promise<void> {
    if (!this.session) throw new Error("Open a workspace first");
    await this.session.prompt(text);
  }

  async cancel(): Promise<void> { await this.session?.abort(); }

  async setModel(provider: string, modelId: string): Promise<ReturnType<PiSessionService["snapshot"]>> {
    if (!this.session) throw new Error("Open a session first");
    const model = (await this.getRuntime()).getModel(provider, modelId);
    if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
    await this.session.setModel(model);
    return this.snapshot();
  }

  snapshot() {
    if (!this.session) return { opened: false, messages: [], running: false };
    return {
      opened: true,
      sessionId: this.session.sessionId,
      sessionFile: this.session.sessionFile,
      messages: toSerializable(this.session.messages),
      running: this.session.isStreaming,
      model: this.session.model ? `${this.session.model.provider}/${this.session.model.id}` : undefined,
    };
  }

  async close(): Promise<void> { this.unsubscribe?.(); await this.session?.abort(); }
}

function toSerializable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}
