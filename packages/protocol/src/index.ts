import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  ApplePiSessionEventSchema,
  ModelItemSchema,
  SessionItemSchema,
  SessionSnapshotSchema,
  type ApplePiSessionEvent,
} from "./domain.js";
import { isJsonSerializable } from "./wire-value.js";

export * from "./domain.js";

export const PROTOCOL_VERSION = 1 as const;

export const Payloads = {
  "system.hello": Type.Object({}, { additionalProperties: false }),
  "session.open": Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  "session.openPath": Type.Object({ cwd: Type.String({ minLength: 1 }), path: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  "session.create": Type.Object({ cwd: Type.String({ minLength: 1 }), provider: Type.Optional(Type.String()), modelId: Type.Optional(Type.String()) }, { additionalProperties: false }),
  "session.list": Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  "session.send": Type.Object({ text: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  "session.cancel": Type.Object({}, { additionalProperties: false }),
  "session.snapshot": Type.Object({}, { additionalProperties: false }),
  "model.list": Type.Object({}, { additionalProperties: false }),
  "model.set": Type.Object({ provider: Type.String({ minLength: 1 }), modelId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
} as const;

export const ResultSchemas = {
  "system.hello": Type.Object({ protocolVersion: Type.Literal(1), pid: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
  "session.open": SessionSnapshotSchema,
  "session.openPath": SessionSnapshotSchema,
  "session.create": SessionSnapshotSchema,
  "session.list": Type.Array(SessionItemSchema),
  "session.send": SessionSnapshotSchema,
  "session.cancel": SessionSnapshotSchema,
  "session.snapshot": SessionSnapshotSchema,
  "model.list": Type.Array(ModelItemSchema),
  "model.set": SessionSnapshotSchema,
} as const;

export const HostEventSchema = Type.Object({
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
  type: Type.Literal("session.event"),
  sequence: Type.Integer({ minimum: 1 }),
  payload: ApplePiSessionEventSchema,
}, { additionalProperties: false });

export type HostCommandType = keyof typeof Payloads;
export type HostCommandPayloads = { [Command in HostCommandType]: import("typebox").Static<(typeof Payloads)[Command]> };
export type HostCommandResults = { [Command in HostCommandType]: import("typebox").Static<(typeof ResultSchemas)[Command]> };
export type HostMessage<Command extends HostCommandType = HostCommandType> = {
  [Current in Command]: { protocolVersion: 1; requestId: string; type: Current; payload: HostCommandPayloads[Current] }
}[Command];
export type HostSuccessResponse<Command extends HostCommandType = HostCommandType> = {
  protocolVersion: 1;
  requestId: string;
  ok: true;
  result: HostCommandResults[Command];
};
export type HostResponse<Command extends HostCommandType = HostCommandType> = HostSuccessResponse<Command> | { protocolVersion: 1; requestId: string; ok: false; error: string };
export type HostEvent = { protocolVersion: 1; type: "session.event"; sequence: number; payload: ApplePiSessionEvent };

export function decodeHostMessage(value: unknown): HostMessage {
  if (!value || typeof value !== "object" || (value as { protocolVersion?: unknown }).protocolVersion !== 1) {
    throw new Error("Unsupported protocol version");
  }
  if (!isJsonSerializable(value)) throw new Error("Invalid host message payload");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => !["protocolVersion", "requestId", "type", "payload"].includes(key)) ||
      typeof record.requestId !== "string" || typeof record.type !== "string" || !(record.type in Payloads)) {
    throw new Error("Invalid host message");
  }
  const schema = Payloads[record.type as HostCommandType];
  if (!Value.Check(schema, record.payload)) throw new Error("Invalid host message payload");
  return value as HostMessage;
}

export function decodeCommandResult<Command extends HostCommandType>(command: Command, value: unknown): HostCommandResults[Command] {
  if (!isJsonSerializable(value) || !Value.Check(ResultSchemas[command], value)) throw new Error(`Invalid result for ${command}`);
  return value as HostCommandResults[Command];
}

export function decodeHostEvent(value: unknown): HostEvent {
  if (!isJsonSerializable(value) || !Value.Check(HostEventSchema, value)) throw new Error("Invalid host event");
  return value as HostEvent;
}

export function encodeRecord(value: unknown): string { return `${JSON.stringify(value)}\n`; }

export class JsonlDecoder {
  private buffered = "";
  push(chunk: string): unknown[] {
    this.buffered += chunk;
    const lines = this.buffered.split("\n");
    this.buffered = lines.pop() ?? "";
    return lines.filter(Boolean).map((line) => JSON.parse(line));
  }
}
