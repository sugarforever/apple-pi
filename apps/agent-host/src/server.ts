import {
  PROTOCOL_VERSION,
  decodeHostRecord,
  type HostCommandResults,
  type HostCommandType,
  decodeHostMessage,
  type HostEvent,
  type HostMessage,
  type HostResponse,
  type ProviderAuthEvent,
} from "@apple-pi/protocol";
import { PI_VERSION, PiSessionService } from "@apple-pi/pi-adapter";

export const HOST_VERSION = "0.4.0" as const;

export class HostServer {
  private readonly pi: PiSessionService;
  private closing?: Promise<void>;
  constructor(private readonly onEvent: (event: HostEvent) => void = () => {}) {
    this.pi = new PiSessionService();
    let sequence = 0;
    this.pi.onEvent((payload) => {
      let record: HostEvent;
      try {
        const decoded = decodeHostRecord({ protocolVersion: PROTOCOL_VERSION, type: "session.event", sequence: ++sequence, payload });
        if (!("type" in decoded)) throw new HostProtocolFault();
        record = decoded;
      } catch {
        throw new HostProtocolFault();
      }
      this.onEvent(record);
    });
  }

  // Pushed while a `provider.startOAuthLogin` operation is in flight, relaying
  // Pi's `AuthInteraction` notify()/prompt() calls for that operationId.
  private pushAuthEvent(operationId: string, payload: ProviderAuthEvent): void {
    let record: HostEvent;
    try {
      const decoded = decodeHostRecord({ protocolVersion: PROTOCOL_VERSION, type: "provider.authEvent", operationId, payload });
      if (!("type" in decoded)) throw new HostProtocolFault();
      record = decoded;
    } catch {
      throw new HostProtocolFault();
    }
    this.onEvent(record);
  }

  async handle(input: unknown): Promise<HostResponse> {
    let message: HostMessage;
    try {
      message = decodeHostMessage(input);
    } catch (error) {
      return failure(typeof (input as { requestId?: unknown })?.requestId === "string" ? (input as { requestId: string }).requestId : "unknown", error);
    }
    if (this.closing && message.type !== "system.shutdown") {
      return failure(message.requestId, new Error("Agent host is shutting down"));
    }
    try {
      switch (message.type) {
        case "system.hello":
          return success("system.hello", message.requestId, {
            protocolVersion: PROTOCOL_VERSION,
            hostVersion: HOST_VERSION,
            piVersion: PI_VERSION,
            capabilities: { sessionEvents: true, modelSelection: true, providerManagement: true, cancellableProviderOperations: true },
            pid: process.pid,
          });
        case "system.shutdown":
          await this.close();
          return success("system.shutdown", message.requestId, {});
        case "session.open":
          return success("session.open", message.requestId, await this.pi.open(message.payload.cwd));
        case "session.openPath":
          return success("session.openPath", message.requestId, await this.pi.open(message.payload.cwd, message.payload.path));
        case "session.create":
          return success("session.create", message.requestId, await this.pi.open(message.payload.cwd, undefined, message.payload, true));
        case "session.list":
          return success("session.list", message.requestId, await this.pi.listSessions(message.payload.cwd));
        case "session.send":
          await this.pi.send(message.payload.text);
          return success("session.send", message.requestId, this.pi.snapshot());
        case "session.cancel":
          await this.pi.cancel();
          return success("session.cancel", message.requestId, this.pi.snapshot());
        case "session.snapshot":
          return success("session.snapshot", message.requestId, this.pi.snapshot());
        case "model.list":
          return success("model.list", message.requestId, await this.pi.listModels());
        case "model.set":
          return success("model.set", message.requestId, await this.pi.setModel(message.payload.provider, message.payload.modelId));
        case "provider.list":
          return success("provider.list", message.requestId, await this.pi.providers.list());
        case "provider.connectApiKey":
          return success(
            "provider.connectApiKey",
            message.requestId,
            await this.pi.providers.connectApiKey(message.payload.providerId, message.payload.apiKey, message.payload.operationId, message.payload.timeoutMs),
          );
        case "provider.disconnect":
          return success(
            "provider.disconnect",
            message.requestId,
            await this.pi.providers.disconnect(message.payload.providerId, message.payload.operationId, message.payload.timeoutMs),
          );
        case "provider.verify":
          return success(
            "provider.verify",
            message.requestId,
            await this.pi.providers.verify(message.payload.providerId, message.payload.operationId, message.payload.timeoutMs),
          );
        case "model.refresh":
          return success(
            "model.refresh",
            message.requestId,
            await this.pi.providers.refresh(message.payload.providerIds, message.payload.operationId, message.payload.timeoutMs),
          );
        case "operation.cancel":
          return success("operation.cancel", message.requestId, { cancelled: this.pi.providers.cancel(message.payload.operationId) });
        case "provider.startOAuthLogin":
          return success(
            "provider.startOAuthLogin",
            message.requestId,
            await this.pi.providers.oauthLogin(message.payload.providerId, message.payload.operationId, message.payload.timeoutMs, (event) =>
              this.pushAuthEvent(message.payload.operationId, event),
            ),
          );
        case "provider.respondOAuthPrompt":
          return success("provider.respondOAuthPrompt", message.requestId, {
            accepted: this.pi.providers.respondOAuthPrompt(message.payload.operationId, message.payload.promptId, message.payload.value),
          });
      }
    } catch (error) {
      return failure(message.requestId, isProviderCommand(message.type) ? new Error("Provider operation failed") : error);
    }
  }

  close(): Promise<void> {
    return (this.closing ??= this.pi.close());
  }
}

function success<Command extends HostCommandType>(command: Command, requestId: string, result: HostCommandResults[Command]): HostResponse<Command> {
  try {
    const record = decodeHostRecord({ protocolVersion: PROTOCOL_VERSION, requestId, ok: true, result }, command);
    if ("type" in record) throw new HostProtocolFault();
    return record;
  } catch {
    throw new HostProtocolFault();
  }
}

function failure(requestId: string, error: unknown): HostResponse {
  const message = error instanceof HostProtocolFault ? error.message : error instanceof Error && error.message ? error.message : "Agent host request failed";
  return decodeHostRecord({ protocolVersion: PROTOCOL_VERSION, requestId, ok: false, error: message }) as HostResponse;
}

class HostProtocolFault extends Error {
  constructor() {
    super("Agent host protocol fault");
  }
}

function isProviderCommand(type: HostCommandType): boolean {
  return type.startsWith("provider.") || type === "model.refresh" || type === "operation.cancel";
}
