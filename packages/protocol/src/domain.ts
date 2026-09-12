import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { isJsonSerializable } from "./wire-value.js";

const closedObject = <T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });

export const JsonValueSchema = Type.Cyclic({
  JsonValue: Type.Union([
    Type.Null(),
    Type.Boolean(),
    Type.Number(),
    Type.String(),
    Type.Array(Type.Ref("JsonValue")),
    Type.Record(Type.String(), Type.Ref("JsonValue")),
  ]),
}, "JsonValue");
export type JsonValue = Static<typeof JsonValueSchema>;

export const TextContentPartSchema = closedObject({
  type: Type.Literal("text"),
  text: Type.String(),
});
export type TextContentPart = Static<typeof TextContentPartSchema>;

export const ThinkingContentPartSchema = closedObject({
  type: Type.Literal("thinking"),
  text: Type.String(),
});
export type ThinkingContentPart = Static<typeof ThinkingContentPartSchema>;

export const ToolCallContentPartSchema = closedObject({
  type: Type.Literal("tool_call"),
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  arguments: Type.Record(Type.String(), JsonValueSchema),
});
export type ToolCallContentPart = Static<typeof ToolCallContentPartSchema>;

export const ToolOutputPartSchema = Type.Union([
  TextContentPartSchema,
  closedObject({
    type: Type.Literal("image"),
    data: Type.String(),
    mimeType: Type.String({ minLength: 1 }),
  }),
]);
export type ToolOutputPart = Static<typeof ToolOutputPartSchema>;

export const ToolResultContentPartSchema = closedObject({
  type: Type.Literal("tool_result"),
  toolCallId: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  output: Type.Array(ToolOutputPartSchema),
  isError: Type.Boolean(),
});
export type ToolResultContentPart = Static<typeof ToolResultContentPartSchema>;

export const ApplePiContentPartSchema = Type.Union([
  TextContentPartSchema,
  ThinkingContentPartSchema,
  ToolCallContentPartSchema,
  ToolResultContentPartSchema,
]);
export type ApplePiContentPart = Static<typeof ApplePiContentPartSchema>;

export const ApplePiMessageSchema = Type.Union([
  closedObject({
    role: Type.Literal("user"),
    content: Type.Array(TextContentPartSchema),
  }),
  closedObject({
    role: Type.Literal("assistant"),
    content: Type.Array(Type.Union([TextContentPartSchema, ThinkingContentPartSchema, ToolCallContentPartSchema])),
  }),
  closedObject({
    role: Type.Literal("tool"),
    content: Type.Array(ToolResultContentPartSchema),
  }),
]);
export type ApplePiMessage = Static<typeof ApplePiMessageSchema>;

export const ModelItemSchema = closedObject({
  provider: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
});
export type ModelItem = Static<typeof ModelItemSchema>;

const IsoTimestampSchema = Type.Refine(
  Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" }),
  (value) => {
    const timestamp = new Date(value);
    return Number.isFinite(timestamp.valueOf()) && timestamp.toISOString() === value;
  },
);

export const SessionItemSchema = closedObject({
  id: Type.String({ minLength: 1 }),
  path: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  created: IsoTimestampSchema,
  modified: IsoTimestampSchema,
  messageCount: Type.Integer({ minimum: 0 }),
});
export type SessionItem = Static<typeof SessionItemSchema>;

export const SessionSnapshotSchema = Type.Union([
  closedObject({
    opened: Type.Literal(false),
    messages: Type.Array(ApplePiMessageSchema),
    running: Type.Literal(false),
  }),
  closedObject({
    opened: Type.Literal(true),
    sessionId: Type.String({ minLength: 1 }),
    sessionFile: Type.Optional(Type.String({ minLength: 1 })),
    messages: Type.Array(ApplePiMessageSchema),
    running: Type.Boolean(),
    model: Type.Optional(ModelItemSchema),
  }),
]);
export type SessionSnapshot = Static<typeof SessionSnapshotSchema>;

export const HostCapabilitiesSchema = closedObject({
  sessionEvents: Type.Boolean(),
  modelSelection: Type.Boolean(),
});
export type HostCapabilities = Static<typeof HostCapabilitiesSchema>;

export const ApplePiSessionEventSchema = Type.Union([
  closedObject({
    type: Type.Literal("text_delta"),
    text: Type.String(),
  }),
  closedObject({
    type: Type.Literal("thinking_delta"),
    text: Type.String(),
  }),
  closedObject({
    type: Type.Literal("tool_call"),
    phase: Type.Union([Type.Literal("started"), Type.Literal("updated"), Type.Literal("completed")]),
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    arguments: Type.Record(Type.String(), JsonValueSchema),
  }),
  closedObject({
    type: Type.Literal("tool_result"),
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    output: Type.Array(ToolOutputPartSchema),
    isError: Type.Boolean(),
  }),
  closedObject({
    type: Type.Literal("lifecycle"),
    phase: Type.Union([Type.Literal("started"), Type.Literal("completed"), Type.Literal("cancelled"), Type.Literal("failed")]),
    message: Type.Optional(Type.String()),
  }),
  closedObject({
    type: Type.Literal("resync_required"),
    reason: Type.String({ minLength: 1 }),
  }),
]);
export type ApplePiSessionEvent = Static<typeof ApplePiSessionEventSchema>;

function decode<TSchemaType extends TSchema>(schema: TSchemaType, value: unknown, label: string): Static<TSchemaType> {
  if (!isJsonSerializable(value) || !Value.Check(schema, value)) throw new Error(`Invalid ${label}`);
  return value as Static<TSchemaType>;
}

export const decodeApplePiContentPart = (value: unknown): ApplePiContentPart => decode(ApplePiContentPartSchema, value, "Apple Pi content part");
export const decodeApplePiMessage = (value: unknown): ApplePiMessage => decode(ApplePiMessageSchema, value, "Apple Pi message");
export const decodeApplePiSessionEvent = (value: unknown): ApplePiSessionEvent => decode(ApplePiSessionEventSchema, value, "Apple Pi session event");
export const decodeHostCapabilities = (value: unknown): HostCapabilities => decode(HostCapabilitiesSchema, value, "host capabilities");
export const decodeModelItem = (value: unknown): ModelItem => decode(ModelItemSchema, value, "model item");
export const decodeSessionItem = (value: unknown): SessionItem => decode(SessionItemSchema, value, "session item");
export const decodeSessionSnapshot = (value: unknown): SessionSnapshot => decode(SessionSnapshotSchema, value, "session snapshot");
