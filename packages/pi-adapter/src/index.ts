import { createAgentSession, ModelRuntime, SessionManager, type AgentSession, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { decodeSessionSnapshot, type ApplePiSessionEvent, type ModelItem, type SessionItem, type SessionSnapshot } from "@apple-pi/protocol";
import { mapPiEvent, mapPiMessages, mapPiModel, mapPiSessionItem } from "./mappers.js";
import { PiProviderService } from "./provider-service.js";
import adapterPackage from "../package.json" with { type: "json" };

export { mapPiEvent, mapPiMessages, mapPiModel, mapPiSessionItem } from "./mappers.js";
export { PiProviderService } from "./provider-service.js";

export type PiEventListener = (event: ApplePiSessionEvent) => void;

export const PI_VERSION = adapterPackage.dependencies["@earendil-works/pi-coding-agent"];

interface SessionOwner {
  session: AgentSession;
  unsubscribe?: () => void;
}

export class PiSessionService {
  private owner?: SessionOwner;
  private listener?: PiEventListener;
  private runtime?: ModelRuntime;
  private lifecycle: Promise<void> = Promise.resolve();
  readonly providers = new PiProviderService(() => this.getRuntime());

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
    return this.serializeLifecycle(async () => {
      const recent = createNew ? [] : await SessionManager.list(cwd);
      const selectedPath = sessionPath ?? recent[0]?.path;
      if (selectedPath && this.owner?.session.sessionFile === selectedPath) return this.snapshot();
      const manager = selectedPath ? SessionManager.open(selectedPath, undefined, cwd) : SessionManager.create(cwd);
      const runtime = await this.getRuntime();
      const model = modelRef?.provider && modelRef.modelId ? runtime.getModel(modelRef.provider, modelRef.modelId) : undefined;
      const result = await createAgentSession({ cwd, sessionManager: manager, modelRuntime: runtime, ...(model ? { model } : {}) });
      const nextOwner: SessionOwner = { session: result.session };
      try {
        nextOwner.unsubscribe = result.session.subscribe((event: AgentSessionEvent) => {
          if (this.owner === nextOwner) this.listener?.(mapPiEvent(event));
        });
      } catch (error) {
        await this.release(nextOwner, false);
        throw error;
      }
      const previousOwner = this.owner;
      this.owner = nextOwner;
      if (previousOwner) await this.release(previousOwner, false);
      return this.snapshot();
    });
  }

  async send(text: string): Promise<void> {
    if (!this.owner) throw new Error("Open a workspace first");
    await this.owner.session.prompt(text);
  }

  async cancel(): Promise<void> { await this.owner?.session.abort(); }

  async setModel(provider: string, modelId: string): Promise<SessionSnapshot> {
    return this.serializeLifecycle(async () => {
      if (!this.owner) throw new Error("Open a session first");
      const model = (await this.getRuntime()).getModel(provider, modelId);
      if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
      await this.owner.session.setModel(model);
      return this.snapshot();
    });
  }

  snapshot(): SessionSnapshot {
    const session = this.owner?.session;
    if (!session) return decodeSessionSnapshot({ opened: false, messages: [], running: false });
    return decodeSessionSnapshot({
      opened: true,
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      messages: mapPiMessages(session.messages),
      running: session.isStreaming,
      ...(session.model ? { model: mapPiModel(session.model) } : {}),
    });
  }

  async close(): Promise<void> {
    return this.serializeLifecycle(async () => {
      const owner = this.owner;
      if (!owner) return;
      this.owner = undefined;
      await this.release(owner);
    });
  }

  private serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycle.then(operation, operation);
    this.lifecycle = result.then(() => undefined, () => undefined);
    return result;
  }

  private async release(owner: SessionOwner, propagateFailure = true): Promise<void> {
    let failure: unknown;
    try { owner.unsubscribe?.(); } catch (error) { failure = error; }
    try { await owner.session.abort(); } catch (error) { failure ??= error; }
    try { owner.session.dispose(); } catch (error) { failure ??= error; }
    if (failure && propagateFailure) throw failure;
  }
}
