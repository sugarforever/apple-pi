import { PROTOCOL_VERSION, decodeCommandResult, type HostCommandResults, type HostCommandType, decodeHostMessage, type HostEvent, type HostMessage, type HostResponse } from "@apple-pi/protocol";
import { PI_VERSION, PiSessionService } from "@apple-pi/pi-adapter";

export const HOST_VERSION = "0.1.0" as const;

export class HostServer {
  private readonly pi: PiSessionService;
  constructor(onEvent: (event: HostEvent) => void = () => {}) {
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
      switch (message.type) {
        case "system.hello": return success("system.hello", message.requestId, {
          protocolVersion: PROTOCOL_VERSION,
          hostVersion: HOST_VERSION,
          piVersion: PI_VERSION,
          capabilities: { sessionEvents: true, modelSelection: true },
          pid: process.pid,
        });
        case "session.open": return success("session.open", message.requestId, await this.pi.open(message.payload.cwd));
        case "session.openPath": return success("session.openPath", message.requestId, await this.pi.open(message.payload.cwd, message.payload.path));
        case "session.create": return success("session.create", message.requestId, await this.pi.open(message.payload.cwd, undefined, message.payload, true));
        case "session.list": return success("session.list", message.requestId, await this.pi.listSessions(message.payload.cwd));
        case "session.send": await this.pi.send(message.payload.text); return success("session.send", message.requestId, this.pi.snapshot());
        case "session.cancel": await this.pi.cancel(); return success("session.cancel", message.requestId, this.pi.snapshot());
        case "session.snapshot": return success("session.snapshot", message.requestId, this.pi.snapshot());
        case "model.list": return success("model.list", message.requestId, await this.pi.listModels());
        case "model.set": return success("model.set", message.requestId, await this.pi.setModel(message.payload.provider, message.payload.modelId));
      }
    } catch (error) {
      return { protocolVersion: 1, requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

function success<Command extends HostCommandType>(command: Command, requestId: string, result: HostCommandResults[Command]): HostResponse<Command> {
  return { protocolVersion: PROTOCOL_VERSION, requestId, ok: true, result: decodeCommandResult(command, result) };
}
