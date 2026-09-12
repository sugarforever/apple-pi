import { PROTOCOL_VERSION, decodeHostMessage, type HostCommandResults, type HostCommandType, type HostMessage, type HostResponse } from "@apple-pi/protocol";
import { PiSessionService } from "@apple-pi/pi-adapter";

export class HostServer {
  private readonly pi: PiSessionService;
  constructor(onEvent: (event: unknown) => void = () => {}) {
    this.pi = new PiSessionService();
    let sequence = 0;
    this.pi.onEvent((payload) => onEvent({ protocolVersion: 1, type: "session.event", sequence: ++sequence, payload }));
  }

  async handle(input: unknown): Promise<HostResponse> {
    let message: HostMessage;
    try { message = decodeHostMessage(input); } catch (error) {
      return { protocolVersion: 1, requestId: typeof (input as { requestId?: unknown })?.requestId === "string" ? (input as { requestId: string }).requestId : "unknown", ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    try {
      let result: unknown;
      switch (message.type) {
        case "system.hello": result = { protocolVersion: PROTOCOL_VERSION, pid: process.pid }; break;
        case "session.open": result = await this.pi.open((message.payload as { cwd: string }).cwd); break;
        case "session.openPath": { const payload = message.payload as { cwd: string; path: string }; result = await this.pi.open(payload.cwd, payload.path); break; }
        case "session.create": { const payload = message.payload as { cwd: string; provider?: string; modelId?: string }; result = await this.pi.open(payload.cwd, undefined, payload, true); break; }
        case "session.list": result = await this.pi.listSessions((message.payload as { cwd: string }).cwd); break;
        case "session.send": await this.pi.send((message.payload as { text: string }).text); result = this.pi.snapshot(); break;
        case "session.cancel": await this.pi.cancel(); result = this.pi.snapshot(); break;
        case "session.snapshot": result = this.pi.snapshot(); break;
        case "model.list": result = await this.pi.listModels(); break;
        case "model.set": { const payload = message.payload as { provider: string; modelId: string }; result = await this.pi.setModel(payload.provider, payload.modelId); break; }
      }
      return { protocolVersion: 1, requestId: message.requestId, ok: true, result: result as HostCommandResults[HostCommandType] };
    } catch (error) {
      return { protocolVersion: 1, requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
