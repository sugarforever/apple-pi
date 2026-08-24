import { Type } from "typebox";
import { Value } from "typebox/value";

export const PROTOCOL_VERSION = 1 as const;

const Payloads = {
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

export type HostCommandType = keyof typeof Payloads;
export type HostMessage = { protocolVersion: 1; requestId: string; type: HostCommandType; payload: Record<string, unknown> };
export type HostResponse = { protocolVersion: 1; requestId: string; ok: true; result: unknown } | { protocolVersion: 1; requestId: string; ok: false; error: string };
export type HostEvent = { protocolVersion: 1; type: "session.event"; sequence: number; payload: unknown };

export function decodeHostMessage(value: unknown): HostMessage {
  if (!value || typeof value !== "object" || (value as { protocolVersion?: unknown }).protocolVersion !== 1) {
    throw new Error("Unsupported protocol version");
  }
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
