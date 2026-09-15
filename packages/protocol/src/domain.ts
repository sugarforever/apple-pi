import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { isJsonSerializable } from "./wire-value.js";

const closedObject = <T extends Parameters<typeof Type.Object>[0]>(properties: T) => Type.Object(properties, { additionalProperties: false });

export const JsonValueSchema = Type.Cyclic(
  {
    JsonValue: Type.Union([
      Type.Null(),
      Type.Boolean(),
      Type.Number(),
      Type.String(),
      Type.Array(Type.Ref("JsonValue")),
      Type.Record(Type.String(), Type.Ref("JsonValue")),
    ]),
  },
  "JsonValue",
);
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

export const ApplePiContentPartSchema = Type.Union([TextContentPartSchema, ThinkingContentPartSchema, ToolCallContentPartSchema, ToolResultContentPartSchema]);
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

const IsoTimestampSchema = Type.Refine(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" }), (value) => {
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.valueOf()) && timestamp.toISOString() === value;
});

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
  providerManagement: Type.Boolean(),
  cancellableProviderOperations: Type.Boolean(),
});
export type HostCapabilities = Static<typeof HostCapabilitiesSchema>;

export const ProviderAuthMethodSchema = Type.Union([Type.Literal("api_key"), Type.Literal("oauth")]);
export type ProviderAuthMethod = Static<typeof ProviderAuthMethodSchema>;

export const CredentialSourceSchema = Type.Union([
  Type.Literal("apple_pi"),
  Type.Literal("shared_pi_profile"),
  Type.Literal("environment"),
  Type.Literal("command"),
  Type.Literal("oauth"),
  Type.Literal("unavailable"),
]);
export type CredentialSource = Static<typeof CredentialSourceSchema>;

export const ProviderDiagnosticSchema = closedObject({
  code: Type.Union([
    Type.Literal("authentication_required"),
    Type.Literal("authentication_failed"),
    Type.Literal("provider_not_found"),
    Type.Literal("operation_cancelled"),
    Type.Literal("operation_timed_out"),
    Type.Literal("model_refresh_failed"),
    Type.Literal("secure_storage_unavailable"),
    Type.Literal("credential_unresolved"),
    Type.Literal("invalid_provider_config"),
  ]),
  severity: Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("error")]),
  message: Type.String({ minLength: 1, maxLength: 240 }),
  action: Type.Optional(Type.Union([Type.Literal("connect"), Type.Literal("reconnect"), Type.Literal("retry"), Type.Literal("check_environment")])),
});
export type ProviderDiagnostic = Static<typeof ProviderDiagnosticSchema>;

export const ProviderItemSchema = closedObject({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  authMethods: Type.Array(ProviderAuthMethodSchema, { minItems: 1 }),
  status: Type.Union([Type.Literal("connected"), Type.Literal("disconnected"), Type.Literal("error")]),
  credentialSource: CredentialSourceSchema,
  availableModelCount: Type.Integer({ minimum: 0 }),
  diagnostics: Type.Array(ProviderDiagnosticSchema),
});
export type ProviderItem = Static<typeof ProviderItemSchema>;

export const ProviderOperationResultSchema = closedObject({
  provider: Type.Optional(ProviderItemSchema),
  diagnostics: Type.Array(ProviderDiagnosticSchema),
});
export type ProviderOperationResult = Static<typeof ProviderOperationResultSchema>;

export const ModelCatalogRefreshResultSchema = closedObject({
  providers: Type.Array(ProviderItemSchema),
  models: Type.Array(ModelItemSchema),
  diagnostics: Type.Array(ProviderDiagnosticSchema),
});
export type ModelCatalogRefreshResult = Static<typeof ModelCatalogRefreshResultSchema>;

// The only Pi "api" implementation this version of the SDK exposes that matches the
// classic meaning of "OpenAI-compatible endpoint" (Chat Completions-shaped request/
// response, the format vLLM/llama.cpp/LM Studio/OpenRouter-style proxies speak). Pi
// 0.84.2 also ships "openai-responses" and several provider-specific APIs (see
// `@earendil-works/pi-ai`'s `KnownApi`), but those are deliberately out of scope here:
// issue #27 asks for "OpenAI-compatible providers", not general models.json authoring.
export const CustomProviderApiSchema = Type.Literal("openai-completions");
export type CustomProviderApi = Static<typeof CustomProviderApiSchema>;

export const CustomModelDefinitionSchema = closedObject({
  id: Type.String({ minLength: 1, maxLength: 200 }),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  reasoning: Type.Optional(Type.Boolean()),
  contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
  maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
});
export type CustomModelDefinition = Static<typeof CustomModelDefinitionSchema>;

// A deliberately narrow slice of Pi's real `compat` union (see `ModelConfig`'s
// `OpenAICompletionsCompatSchema`, which alone has ~20 fields spanning routing,
// chat-template quirks, and cache-control formats for providers Apple Pi does not
// target here). These four are the ones that actually matter for a self-hosted or
// third-party OpenAI-compatible endpoint (vLLM, llama.cpp, LM Studio, and similar
// often reject `max_completion_tokens`, the "developer" role, or strict JSON mode).
export const CustomProviderCompatSchema = closedObject({
  supportsDeveloperRole: Type.Optional(Type.Boolean()),
  supportsStrictMode: Type.Optional(Type.Boolean()),
  supportsUsageInStreaming: Type.Optional(Type.Boolean()),
  maxTokensField: Type.Optional(Type.Union([Type.Literal("max_tokens"), Type.Literal("max_completion_tokens")])),
});
export type CustomProviderCompat = Static<typeof CustomProviderCompatSchema>;

// The non-secret, Apple-Pi-managed shape of a custom OpenAI-compatible provider.
// Never carries an API key: that is stored exclusively through the existing
// `provider.connectApiKey`/CredentialBroker path once the provider is registered.
export const CustomProviderDefinitionSchema = closedObject({
  id: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9][a-z0-9-_]*$" }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  baseUrl: Type.String({ minLength: 1, maxLength: 2000 }),
  api: CustomProviderApiSchema,
  compat: Type.Optional(CustomProviderCompatSchema),
  models: Type.Array(CustomModelDefinitionSchema, { minItems: 1, maxItems: 50 }),
});
export type CustomProviderDefinition = Static<typeof CustomProviderDefinitionSchema>;

// Apple-Pi-owned mirror of Pi's `AuthPrompt` (see `@earendil-works/pi-ai`'s
// `auth/types.ts`), minus its non-serializable per-prompt `AbortSignal`: a
// `promptId` stands in for it on the wire, and `provider.respondOAuthPrompt`
// answers a specific prompt by id.
export const ProviderAuthPromptSchema = Type.Union([
  closedObject({
    type: Type.Literal("text"),
    promptId: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    placeholder: Type.Optional(Type.String()),
  }),
  closedObject({
    type: Type.Literal("secret"),
    promptId: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    placeholder: Type.Optional(Type.String()),
  }),
  closedObject({
    type: Type.Literal("select"),
    promptId: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    options: Type.Array(closedObject({ id: Type.String({ minLength: 1 }), label: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()) }), {
      minItems: 1,
    }),
  }),
  closedObject({
    type: Type.Literal("manual_code"),
    promptId: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    placeholder: Type.Optional(Type.String()),
  }),
]);
export type ProviderAuthPrompt = Static<typeof ProviderAuthPromptSchema>;

// Apple-Pi-owned mirror of Pi's `AuthEvent`, plus a `prompt` variant that
// carries a `ProviderAuthPrompt` needing a `provider.respondOAuthPrompt` reply.
// Never carries a token, code, or other secret: `auth_url`/`device_code` are
// public onboarding artifacts, and the one value a user might type back
// (an authorization code pasted as a `manual_code` prompt reply) is a
// single-use exchange code, not the persisted credential.
export const ProviderAuthEventSchema = Type.Union([
  closedObject({
    type: Type.Literal("info"),
    message: Type.String({ minLength: 1 }),
    links: Type.Optional(Type.Array(closedObject({ url: Type.String({ minLength: 1 }), label: Type.Optional(Type.String()) }))),
  }),
  closedObject({ type: Type.Literal("auth_url"), url: Type.String({ minLength: 1 }), instructions: Type.Optional(Type.String()) }),
  closedObject({
    type: Type.Literal("device_code"),
    userCode: Type.String({ minLength: 1 }),
    verificationUri: Type.String({ minLength: 1 }),
    intervalSeconds: Type.Optional(Type.Number()),
    expiresInSeconds: Type.Optional(Type.Number()),
  }),
  closedObject({ type: Type.Literal("progress"), message: Type.String({ minLength: 1 }) }),
  closedObject({ type: Type.Literal("prompt"), prompt: ProviderAuthPromptSchema }),
]);
export type ProviderAuthEvent = Static<typeof ProviderAuthEventSchema>;

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
export const decodeProviderItem = (value: unknown): ProviderItem => decode(ProviderItemSchema, value, "provider item");
export const decodeProviderOperationResult = (value: unknown): ProviderOperationResult =>
  decode(ProviderOperationResultSchema, value, "provider operation result");
export const decodeModelCatalogRefreshResult = (value: unknown): ModelCatalogRefreshResult =>
  decode(ModelCatalogRefreshResultSchema, value, "model catalog refresh result");
export const decodeProviderAuthEvent = (value: unknown): ProviderAuthEvent => decode(ProviderAuthEventSchema, value, "provider auth event");
export const decodeModelItem = (value: unknown): ModelItem => decode(ModelItemSchema, value, "model item");
export const decodeCustomProviderDefinition = (value: unknown): CustomProviderDefinition =>
  decode(CustomProviderDefinitionSchema, value, "custom provider definition");
export const decodeSessionItem = (value: unknown): SessionItem => decode(SessionItemSchema, value, "session item");
export const decodeSessionSnapshot = (value: unknown): SessionSnapshot => decode(SessionSnapshotSchema, value, "session snapshot");
