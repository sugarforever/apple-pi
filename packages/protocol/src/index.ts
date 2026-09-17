import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  ApplePiSessionEventSchema,
  CustomProviderDefinitionSchema,
  HostCapabilitiesSchema,
  ModelCatalogRefreshResultSchema,
  ModelItemSchema,
  ProviderAuthEventSchema,
  ProviderItemSchema,
  ProviderOperationResultSchema,
  SessionItemSchema,
  SessionSnapshotSchema,
  SkillCatalogSchema,
  SkillItemSchema,
  SkillOperationResultSchema,
  SkillScopeSchema,
  type ApplePiSessionEvent,
  type ProviderAuthEvent,
} from "./domain.js";
import { isJsonSerializable } from "./wire-value.js";

export * from "./domain.js";

export const PROTOCOL_VERSION = 1 as const;
export const SUPPORTED_PI_VERSION = "0.84.2" as const;

export const Payloads = {
  "system.hello": Type.Object({}, { additionalProperties: false }),
  "system.shutdown": Type.Object({}, { additionalProperties: false }),
  "session.open": Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  "session.openPath": Type.Object({ cwd: Type.String({ minLength: 1 }), path: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  "session.create": Type.Object(
    { cwd: Type.String({ minLength: 1 }), provider: Type.Optional(Type.String()), modelId: Type.Optional(Type.String()) },
    { additionalProperties: false },
  ),
  "session.list": Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  "session.send": Type.Object({ text: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  "session.cancel": Type.Object({}, { additionalProperties: false }),
  "session.snapshot": Type.Object({}, { additionalProperties: false }),
  "model.list": Type.Object({}, { additionalProperties: false }),
  "model.set": Type.Object({ provider: Type.String({ minLength: 1 }), modelId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  "provider.list": Type.Object({}, { additionalProperties: false }),
  "provider.connectApiKey": Type.Object(
    {
      providerId: Type.String({ minLength: 1 }),
      apiKey: Type.String({ minLength: 1 }),
      operationId: Type.String({ minLength: 1 }),
      timeoutMs: Type.Integer({ minimum: 100, maximum: 30_000 }),
    },
    { additionalProperties: false },
  ),
  "provider.disconnect": Type.Object(
    { providerId: Type.String({ minLength: 1 }), operationId: Type.String({ minLength: 1 }), timeoutMs: Type.Integer({ minimum: 100, maximum: 30_000 }) },
    { additionalProperties: false },
  ),
  "provider.verify": Type.Object(
    { providerId: Type.String({ minLength: 1 }), operationId: Type.String({ minLength: 1 }), timeoutMs: Type.Integer({ minimum: 100, maximum: 30_000 }) },
    { additionalProperties: false },
  ),
  "model.refresh": Type.Object(
    {
      providerIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
      operationId: Type.String({ minLength: 1 }),
      timeoutMs: Type.Integer({ minimum: 100, maximum: 30_000 }),
    },
    { additionalProperties: false },
  ),
  "operation.cancel": Type.Object({ operationId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  // An interactive OAuth login waits on the user (opening a browser, approving
  // a device code), so it needs a much longer budget than the other bounded
  // provider operations above; 20 minutes comfortably covers the OpenAI Codex
  // device-code flow's own 15-minute expiry plus a margin for the browser flow.
  "provider.startOAuthLogin": Type.Object(
    { providerId: Type.String({ minLength: 1 }), operationId: Type.String({ minLength: 1 }), timeoutMs: Type.Integer({ minimum: 100, maximum: 1_200_000 }) },
    { additionalProperties: false },
  ),
  "provider.respondOAuthPrompt": Type.Object(
    { operationId: Type.String({ minLength: 1 }), promptId: Type.String({ minLength: 1 }), value: Type.String() },
    { additionalProperties: false },
  ),
  "provider.listCustom": Type.Object({}, { additionalProperties: false }),
  "provider.addCustom": Type.Object(
    {
      definition: CustomProviderDefinitionSchema,
      operationId: Type.String({ minLength: 1 }),
      timeoutMs: Type.Integer({ minimum: 100, maximum: 30_000 }),
    },
    { additionalProperties: false },
  ),
  "provider.updateCustom": Type.Object(
    {
      id: Type.String({ minLength: 1 }),
      definition: CustomProviderDefinitionSchema,
      operationId: Type.String({ minLength: 1 }),
      timeoutMs: Type.Integer({ minimum: 100, maximum: 30_000 }),
    },
    { additionalProperties: false },
  ),
  "provider.removeCustom": Type.Object(
    { id: Type.String({ minLength: 1 }), operationId: Type.String({ minLength: 1 }), timeoutMs: Type.Integer({ minimum: 100, maximum: 30_000 }) },
    { additionalProperties: false },
  ),
  "skill.list": Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  // Deliberately its own command rather than an extra field on skill.list's
  // SkillCatalog: skill.list exists specifically to mirror exactly what Pi's
  // own session would discover (see PiSkillService.list's doc comment in
  // @apple-pi/pi-adapter), and a disabled skill is, by design, invisible to
  // that discovery. Same payload shape as skill.list (just a cwd) since it
  // scans the same two scopes, only the sibling "-disabled" holding
  // directories instead of the managed roots.
  "skill.listDisabled": Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  "skill.install": Type.Object(
    { cwd: Type.String({ minLength: 1 }), scope: SkillScopeSchema, sourcePath: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  "skill.setEnabled": Type.Object(
    { cwd: Type.String({ minLength: 1 }), scope: SkillScopeSchema, name: Type.String({ minLength: 1 }), enabled: Type.Boolean() },
    { additionalProperties: false },
  ),
  "skill.remove": Type.Object(
    { cwd: Type.String({ minLength: 1 }), scope: SkillScopeSchema, name: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
} as const;

export const ResultSchemas = {
  "system.hello": Type.Object(
    {
      protocolVersion: Type.Literal(PROTOCOL_VERSION),
      hostVersion: Type.String({ minLength: 1 }),
      piVersion: Type.String({ minLength: 1 }),
      capabilities: HostCapabilitiesSchema,
      pid: Type.Integer({ minimum: 1 }),
    },
    { additionalProperties: false },
  ),
  "system.shutdown": Type.Object({}, { additionalProperties: false }),
  "session.open": SessionSnapshotSchema,
  "session.openPath": SessionSnapshotSchema,
  "session.create": SessionSnapshotSchema,
  "session.list": Type.Array(SessionItemSchema),
  "session.send": SessionSnapshotSchema,
  "session.cancel": SessionSnapshotSchema,
  "session.snapshot": SessionSnapshotSchema,
  "model.list": Type.Array(ModelItemSchema),
  "model.set": SessionSnapshotSchema,
  "provider.list": Type.Array(ProviderItemSchema),
  "provider.connectApiKey": ProviderOperationResultSchema,
  "provider.disconnect": ProviderOperationResultSchema,
  "provider.verify": ProviderOperationResultSchema,
  "model.refresh": ModelCatalogRefreshResultSchema,
  "operation.cancel": Type.Object({ cancelled: Type.Boolean() }, { additionalProperties: false }),
  "provider.startOAuthLogin": ProviderOperationResultSchema,
  "provider.respondOAuthPrompt": Type.Object({ accepted: Type.Boolean() }, { additionalProperties: false }),
  "provider.listCustom": Type.Array(CustomProviderDefinitionSchema),
  "provider.addCustom": ProviderOperationResultSchema,
  "provider.updateCustom": ProviderOperationResultSchema,
  "provider.removeCustom": ProviderOperationResultSchema,
  "skill.list": SkillCatalogSchema,
  // A plain array of SkillItem, not a SkillCatalog: there is no notion of a
  // "diagnostic" for the disabled holding directory (it is Apple Pi's own
  // invention, never something Pi's loader reports collisions/warnings
  // against), so wrapping this in the fuller SkillCatalog shape would just
  // add an always-empty `diagnostics` field.
  "skill.listDisabled": Type.Array(SkillItemSchema),
  "skill.install": SkillOperationResultSchema,
  "skill.setEnabled": SkillOperationResultSchema,
  "skill.remove": SkillOperationResultSchema,
} as const;

export const HostEventSchema = Type.Union([
  Type.Object(
    {
      protocolVersion: Type.Literal(PROTOCOL_VERSION),
      type: Type.Literal("session.event"),
      sequence: Type.Integer({ minimum: 1 }),
      payload: ApplePiSessionEventSchema,
    },
    { additionalProperties: false },
  ),
  // Pushed while a `provider.startOAuthLogin` operation is in flight: relays
  // Pi's `AuthInteraction` notify()/prompt() calls for that operationId. Not
  // sequenced like session events — the desktop only ever needs the latest
  // interaction step for a given login, not a durable ordered log of them.
  Type.Object(
    {
      protocolVersion: Type.Literal(PROTOCOL_VERSION),
      type: Type.Literal("provider.authEvent"),
      operationId: Type.String({ minLength: 1 }),
      payload: ProviderAuthEventSchema,
    },
    { additionalProperties: false },
  ),
]);

export const HostErrorResponseSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    requestId: Type.String(),
    ok: Type.Literal(false),
    error: Type.String(),
  },
  { additionalProperties: false },
);

export type HostCommandType = keyof typeof Payloads;
export type HostCommandPayloads = { [Command in HostCommandType]: import("typebox").Static<(typeof Payloads)[Command]> };
export type HostCommandResults = { [Command in HostCommandType]: import("typebox").Static<(typeof ResultSchemas)[Command]> };
export type HostMessage<Command extends HostCommandType = HostCommandType> = {
  [Current in Command]: { protocolVersion: 1; requestId: string; type: Current; payload: HostCommandPayloads[Current] };
}[Command];
export type HostSuccessResponse<Command extends HostCommandType = HostCommandType> = {
  protocolVersion: 1;
  requestId: string;
  ok: true;
  result: HostCommandResults[Command];
};
export type HostErrorResponse = { protocolVersion: 1; requestId: string; ok: false; error: string };
export type HostResponse<Command extends HostCommandType = HostCommandType> = HostSuccessResponse<Command> | HostErrorResponse;
export type HostEvent =
  | { protocolVersion: 1; type: "session.event"; sequence: number; payload: ApplePiSessionEvent }
  | { protocolVersion: 1; type: "provider.authEvent"; operationId: string; payload: ProviderAuthEvent };

export function decodeHostMessage(value: unknown): HostMessage {
  if (!value || typeof value !== "object" || (value as { protocolVersion?: unknown }).protocolVersion !== 1) {
    throw new Error("Unsupported protocol version");
  }
  if (!isJsonSerializable(value)) throw new Error("Invalid host message payload");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some((key) => !["protocolVersion", "requestId", "type", "payload"].includes(key)) ||
    typeof record.requestId !== "string" ||
    typeof record.type !== "string" ||
    !(record.type in Payloads)
  ) {
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

export function decodeHostRecord<Command extends HostCommandType>(value: unknown, command: Command): HostResponse<Command> | HostEvent;
export function decodeHostRecord(value: unknown): HostErrorResponse | HostEvent;
export function decodeHostRecord<Command extends HostCommandType>(value: unknown, command?: Command): HostResponse<Command> | HostEvent {
  if (!isJsonSerializable(value) || !value || typeof value !== "object") throw new Error("Invalid host record");
  const record = value as Record<string, unknown>;
  if ("type" in record) return decodeHostEvent(value);
  if (record.ok === false) {
    if (!Value.Check(HostErrorResponseSchema, value)) throw new Error("Invalid host error response");
    return value as unknown as HostResponse<Command>;
  }
  if (record.ok === true && command) {
    const schema = Type.Object(
      {
        protocolVersion: Type.Literal(PROTOCOL_VERSION),
        requestId: Type.String(),
        ok: Type.Literal(true),
        result: ResultSchemas[command],
      },
      { additionalProperties: false },
    );
    if (!Value.Check(schema, value)) throw new Error(`Invalid host success response for ${command}`);
    return value as unknown as HostResponse<Command>;
  }
  throw new Error("Invalid host record");
}

export function encodeRecord(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export class JsonlDecoder {
  private buffered = "";
  push(chunk: string): unknown[] {
    this.buffered += chunk;
    const lines = this.buffered.split("\n");
    this.buffered = lines.pop() ?? "";
    return lines.filter(Boolean).map((line) => JSON.parse(line));
  }
}
