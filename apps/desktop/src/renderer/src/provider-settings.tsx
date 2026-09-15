import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, CircleDashed, KeyRound, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type {
  CustomProviderDefinition,
  CustomModelDefinition,
  HostEvent,
  ModelItem,
  ProviderAuthEvent,
  ProviderDiagnostic,
  ProviderItem,
  ProviderOperationResult,
} from "@apple-pi/protocol";

export type ProviderActivity = "idle" | "checking";

// Bridges the OAuth sign-in flow: `start` kicks off `provider.startOAuthLogin`
// and returns its operationId immediately (before the login itself completes)
// so a `subscribe`d `provider.authEvent` can be correlated to it, `respond`
// answers a pending prompt, and `cancel` aborts the operation the same way
// `operation.cancel` cancels any other provider operation.
export interface ProviderOAuthBridge {
  start(providerId: string): { operationId: string; result: Promise<ProviderOperationResult> };
  respond(operationId: string, promptId: string, value: string): Promise<{ accepted: boolean }>;
  cancel(operationId: string): Promise<unknown>;
  subscribe(listener: (event: HostEvent) => void): () => void;
}

export interface ProviderSettingsProps {
  providers: ProviderItem[];
  models: ModelItem[];
  defaultModel?: { provider: string; modelId: string };
  customProviders: CustomProviderDefinition[];
  onConnect(providerId: string, apiKey: string): Promise<ProviderOperationResult>;
  onDisconnect(providerId: string): Promise<ProviderOperationResult>;
  onVerify(providerId: string): Promise<ProviderOperationResult>;
  onRefresh(providerId: string): Promise<void>;
  onDefaultModel(model: { provider: string; modelId: string }): Promise<void>;
  onAddCustomProvider(definition: CustomProviderDefinition): Promise<ProviderOperationResult>;
  onUpdateCustomProvider(id: string, definition: CustomProviderDefinition): Promise<ProviderOperationResult>;
  onRemoveCustomProvider(id: string): Promise<ProviderOperationResult>;
  oauth: ProviderOAuthBridge;
}

// A custom provider is anything Apple Pi's own `provider.listCustom` reports —
// distinct from a built-in provider even once connected, so the UI can offer
// Edit/Remove only where they make sense.
export function isCustomProvider(providerId: string, customProviders: CustomProviderDefinition[]): boolean {
  return customProviders.some((definition) => definition.id === providerId);
}

interface OAuthLoginState {
  providerId: string;
  operationId: string;
  latest?: ProviderAuthEvent;
  promptValue: string;
}

const sourceLabels: Record<ProviderItem["credentialSource"], string> = {
  apple_pi: "Apple Pi secure storage",
  shared_pi_profile: "Shared Pi profile",
  environment: "Environment variable",
  command: "Shell command",
  oauth: "OAuth",
  unavailable: "No credential",
};

export function firstActionableDiagnostic(result: ProviderOperationResult): ProviderDiagnostic | undefined {
  return result.diagnostics.find((item) => item.severity === "error") ?? result.diagnostics[0];
}

// A saved default or an already-open session's model can outlive the
// provider it came from. `models.length === 0` is treated as "not loaded
// yet" rather than "everything was removed", so a transient empty catalog
// never triggers a false recovery.
export function modelUnavailable(models: ModelItem[], ref: { provider: string; modelId: string } | undefined): boolean {
  return Boolean(ref) && models.length > 0 && !models.some((model) => model.provider === ref!.provider && model.modelId === ref!.modelId);
}

// openai-codex has no `api_key` auth method at all, so it never satisfied the
// existing `canManage` check above — there was no way to start signing in to
// it from Settings before this. A provider with both auth methods is free to
// show a "Sign in" button alongside "Connect" once it is disconnected.
export function canStartOAuthLogin(provider: ProviderItem): boolean {
  return provider.authMethods.includes("oauth") && provider.status !== "connected";
}

function OAuthLoginPanel(props: {
  state: OAuthLoginState;
  onCancel: () => void;
  onSubmit: (value: string) => void;
  onPromptValueChange: (value: string) => void;
}) {
  const { latest } = props.state;
  return (
    <div className="oauth-login-panel" role="status" aria-live="polite">
      {!latest && <p>Starting sign-in…</p>}
      {latest?.type === "info" && (
        <div>
          <p>{latest.message}</p>
          {latest.links?.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
              {link.label ?? link.url}
            </a>
          ))}
        </div>
      )}
      {latest?.type === "auth_url" && (
        <div>
          <p>{latest.instructions ?? "Continue in your browser to finish signing in."}</p>
          <a href={latest.url} target="_blank" rel="noreferrer">
            Open sign-in page
          </a>
        </div>
      )}
      {latest?.type === "device_code" && (
        <div>
          <p>Enter this code at {latest.verificationUri}:</p>
          <code className="oauth-device-code">{latest.userCode}</code>
        </div>
      )}
      {latest?.type === "progress" && <p>{latest.message}</p>}
      {latest?.type === "prompt" && latest.prompt.type === "select" && (
        <div className="oauth-prompt-options">
          <p>{latest.prompt.message}</p>
          {latest.prompt.options.map((option) => (
            <button key={option.id} type="button" onClick={() => props.onSubmit(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
      )}
      {latest?.type === "prompt" && latest.prompt.type !== "select" && (
        <form
          className="oauth-prompt-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit(props.state.promptValue);
          }}
        >
          <label htmlFor={`oauth-prompt-${latest.prompt.promptId}`}>{latest.prompt.message}</label>
          <div>
            <input
              id={`oauth-prompt-${latest.prompt.promptId}`}
              type={latest.prompt.type === "secret" ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              placeholder={latest.prompt.placeholder}
              value={props.state.promptValue}
              onChange={(event) => props.onPromptValueChange(event.target.value)}
              autoFocus
            />
            <button type="submit" disabled={!props.state.promptValue.trim()}>
              Continue
            </button>
          </div>
        </form>
      )}
      <button type="button" className="secondary" onClick={props.onCancel}>
        Cancel sign-in
      </button>
    </div>
  );
}

interface CustomModelRow {
  key: string;
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
}

let customModelRowSeq = 0;
const blankModelRow = (): CustomModelRow => ({ key: `row-${++customModelRowSeq}`, id: "", name: "", contextWindow: "", maxTokens: "", reasoning: false });

function modelRowsFrom(models: CustomModelDefinition[]): CustomModelRow[] {
  return models.length
    ? models.map((model) => ({
        key: `row-${++customModelRowSeq}`,
        id: model.id,
        name: model.name ?? "",
        contextWindow: model.contextWindow?.toString() ?? "",
        maxTokens: model.maxTokens?.toString() ?? "",
        reasoning: model.reasoning ?? false,
      }))
    : [blankModelRow()];
}

// Converts the form's string-based rows back into `CustomModelDefinition`s. Rows
// left completely blank (no id typed yet) are dropped rather than rejected, so a
// spare trailing row does not need to be deleted before submitting.
function modelsFromRows(rows: CustomModelRow[]): CustomModelDefinition[] {
  return rows
    .filter((row) => row.id.trim())
    .map((row) => ({
      id: row.id.trim(),
      ...(row.name.trim() ? { name: row.name.trim() } : {}),
      ...(row.reasoning ? { reasoning: true } : {}),
      ...(row.contextWindow.trim() ? { contextWindow: Number(row.contextWindow) } : {}),
      ...(row.maxTokens.trim() ? { maxTokens: Number(row.maxTokens) } : {}),
    }));
}

// The only Pi "api" this form ever submits (see `CustomProviderApiSchema` in
// `@apple-pi/protocol`): the classic OpenAI Chat Completions wire format that
// self-hosted and third-party "OpenAI-compatible" endpoints actually speak.
const CUSTOM_PROVIDER_API = "openai-completions" as const;

function CustomProviderForm(props: {
  initial?: CustomProviderDefinition;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (definition: CustomProviderDefinition) => Promise<ProviderOperationResult>;
  onSaved: (id: string) => void;
}) {
  const editing = Boolean(props.initial);
  const [id, setId] = useState(props.initial?.id ?? "");
  const [name, setName] = useState(props.initial?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(props.initial?.baseUrl ?? "");
  const [rows, setRows] = useState<CustomModelRow[]>(() => modelRowsFrom(props.initial?.models ?? []));
  const [supportsDeveloperRole, setSupportsDeveloperRole] = useState(props.initial?.compat?.supportsDeveloperRole ?? false);
  const [supportsStrictMode, setSupportsStrictMode] = useState(props.initial?.compat?.supportsStrictMode ?? false);
  const [maxTokensField, setMaxTokensField] = useState<"" | "max_tokens" | "max_completion_tokens">(props.initial?.compat?.maxTokensField ?? "");
  const [diagnostic, setDiagnostic] = useState<ProviderDiagnostic | undefined>(undefined);

  const updateRow = (key: string, patch: Partial<CustomModelRow>): void => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setDiagnostic(undefined);
    const models = modelsFromRows(rows);
    if (models.length === 0) {
      setDiagnostic({ code: "invalid_provider_config", severity: "error", message: "Add at least one model." });
      return;
    }
    const compat =
      supportsDeveloperRole || supportsStrictMode || maxTokensField
        ? {
            ...(supportsDeveloperRole ? { supportsDeveloperRole: true } : {}),
            ...(supportsStrictMode ? { supportsStrictMode: true } : {}),
            ...(maxTokensField ? { maxTokensField } : {}),
          }
        : undefined;
    const definition: CustomProviderDefinition = {
      id: id.trim(),
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      api: CUSTOM_PROVIDER_API,
      models,
      ...(compat ? { compat } : {}),
    };
    const result = await props.onSubmit(definition);
    const failure = firstActionableDiagnostic(result);
    if (failure && failure.severity === "error") setDiagnostic(failure);
    else props.onSaved(definition.id);
  };

  return (
    <form className="custom-provider-form" aria-label={editing ? "Edit custom provider" : "Add custom provider"} onSubmit={(event) => void submit(event)}>
      <div className="custom-provider-fields">
        <label>
          <span>Provider ID</span>
          <input
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder="my-local-llm"
            pattern="^[a-z0-9][a-z0-9-_]*$"
            disabled={editing || props.busy}
            required
            autoFocus
          />
        </label>
        <label>
          <span>Display name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="My Local LLM" disabled={props.busy} required />
        </label>
        <label>
          <span>Base URL</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://localhost:8080/v1"
            disabled={props.busy}
            required
          />
        </label>
        <p className="custom-provider-api-note">OpenAI-compatible (Chat Completions API)</p>
      </div>
      <fieldset className="custom-provider-models">
        <legend>Models</legend>
        {rows.map((row) => (
          <div className="custom-provider-model-row" key={row.key}>
            <input
              value={row.id}
              onChange={(event) => updateRow(row.key, { id: event.target.value })}
              placeholder="Model ID"
              aria-label="Model ID"
              disabled={props.busy}
            />
            <input
              value={row.name}
              onChange={(event) => updateRow(row.key, { name: event.target.value })}
              placeholder="Display name (optional)"
              aria-label="Model display name"
              disabled={props.busy}
            />
            <input
              type="number"
              min={1}
              value={row.contextWindow}
              onChange={(event) => updateRow(row.key, { contextWindow: event.target.value })}
              placeholder="Context window"
              aria-label="Context window"
              disabled={props.busy}
            />
            <input
              type="number"
              min={1}
              value={row.maxTokens}
              onChange={(event) => updateRow(row.key, { maxTokens: event.target.value })}
              placeholder="Max tokens"
              aria-label="Max output tokens"
              disabled={props.busy}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Remove model"
              onClick={() => setRows((current) => (current.length > 1 ? current.filter((item) => item.key !== row.key) : current))}
              disabled={props.busy}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => setRows((current) => [...current, blankModelRow()])} disabled={props.busy}>
          <Plus size={13} /> Add model
        </button>
      </fieldset>
      <fieldset className="custom-provider-compat">
        <legend>Compatibility options</legend>
        <label className="checkbox-field">
          <input type="checkbox" checked={supportsDeveloperRole} onChange={(event) => setSupportsDeveloperRole(event.target.checked)} disabled={props.busy} />
          <span>Supports the OpenAI &quot;developer&quot; role</span>
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={supportsStrictMode} onChange={(event) => setSupportsStrictMode(event.target.checked)} disabled={props.busy} />
          <span>Supports strict JSON mode</span>
        </label>
        <label>
          <span>Max tokens parameter</span>
          <select value={maxTokensField} onChange={(event) => setMaxTokensField(event.target.value as typeof maxTokensField)} disabled={props.busy}>
            <option value="">Auto</option>
            <option value="max_tokens">max_tokens</option>
            <option value="max_completion_tokens">max_completion_tokens</option>
          </select>
        </label>
      </fieldset>
      {diagnostic && (
        <p className="provider-diagnostic error" role="alert">
          {diagnostic.message}
        </p>
      )}
      <div className="custom-provider-form-actions">
        <button type="submit" disabled={props.busy}>
          {editing ? "Save changes" : "Add provider"}
        </button>
        <button type="button" className="secondary" onClick={props.onCancel} disabled={props.busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ProviderSettings(props: ProviderSettingsProps) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<Record<string, ProviderActivity>>({});
  const [feedback, setFeedback] = useState<Record<string, ProviderDiagnostic | undefined>>({});
  const [oauthLogin, setOauthLogin] = useState<OAuthLoginState | null>(null);
  // "add" shows a blank form; a provider id shows that provider's edit form;
  // null hides the form entirely. Distinct from `editing` above, which only
  // ever toggles a built-in provider's API-key entry.
  const [customProviderForm, setCustomProviderForm] = useState<"add" | string | null>(null);
  const [customProviderBusy, setCustomProviderBusy] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? props.providers.filter((provider) => `${provider.name} ${provider.id}`.toLocaleLowerCase().includes(needle)) : props.providers;
  }, [props.providers, query]);

  useEffect(() => {
    return props.oauth.subscribe((event) => {
      if (event.type !== "provider.authEvent") return;
      setOauthLogin((current) => (current && current.operationId === event.operationId ? { ...current, latest: event.payload, promptValue: "" } : current));
    });
  }, [props.oauth]);

  const startOAuthLogin = (provider: ProviderItem): void => {
    const { operationId, result } = props.oauth.start(provider.id);
    setOauthLogin({ providerId: provider.id, operationId, promptValue: "" });
    setActivity((current) => ({ ...current, [provider.id]: "checking" }));
    setFeedback((current) => ({ ...current, [provider.id]: undefined }));
    result
      .then((outcome) => {
        const diagnostic = firstActionableDiagnostic(outcome);
        setFeedback((current) => ({ ...current, [provider.id]: diagnostic }));
        if (!diagnostic || diagnostic.severity !== "error") void props.onRefresh(provider.id);
      })
      .catch(() =>
        setFeedback((current) => ({
          ...current,
          [provider.id]: { code: "authentication_failed", severity: "error", message: "Apple Pi could not complete sign-in. Try again.", action: "retry" },
        })),
      )
      .finally(() => {
        setActivity((current) => ({ ...current, [provider.id]: "idle" }));
        setOauthLogin((current) => (current?.operationId === operationId ? null : current));
      });
  };

  const cancelOAuthLogin = (): void => {
    if (oauthLogin) void props.oauth.cancel(oauthLogin.operationId);
  };

  const submitOAuthPrompt = (value: string): void => {
    if (!oauthLogin?.latest || oauthLogin.latest.type !== "prompt" || !value) return;
    void props.oauth.respond(oauthLogin.operationId, oauthLogin.latest.prompt.promptId, value);
    setOauthLogin((current) => (current ? { ...current, promptValue: "" } : current));
  };

  const run = async (providerId: string, operation: () => Promise<ProviderOperationResult>, refresh = false): Promise<boolean> => {
    setActivity((current) => ({ ...current, [providerId]: "checking" }));
    setFeedback((current) => ({ ...current, [providerId]: undefined }));
    try {
      const result = await operation();
      const diagnostic = firstActionableDiagnostic(result);
      setFeedback((current) => ({ ...current, [providerId]: diagnostic }));
      if (diagnostic?.severity === "error") return false;
      if (refresh) await props.onRefresh(providerId);
      return true;
    } catch {
      setFeedback((current) => ({
        ...current,
        [providerId]: {
          code: "authentication_failed",
          severity: "error",
          message: "Apple Pi could not complete this provider operation. Try again.",
          action: "retry",
        },
      }));
      return false;
    } finally {
      setActivity((current) => ({ ...current, [providerId]: "idle" }));
    }
  };

  const connect = async (provider: ProviderItem): Promise<void> => {
    const key = apiKeys[provider.id]?.trim();
    if (!key) return;
    const connected = await run(provider.id, () => props.onConnect(provider.id, key), true);
    setApiKeys((current) => ({ ...current, [provider.id]: "" }));
    if (connected) setEditing(null);
  };

  const removeCustomProvider = async (provider: ProviderItem): Promise<void> => {
    await run(provider.id, () => props.onRemoveCustomProvider(provider.id), true);
  };

  return (
    <section className="provider-settings" aria-labelledby="providers-title">
      <div className="provider-heading">
        <div>
          <h2 id="providers-title">Models &amp; Providers</h2>
          <p>Connect a built-in provider, then choose the model Apple Pi uses by default.</p>
        </div>
        <label className="provider-search">
          <span className="sr-only">Search providers</span>
          <Search size={15} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search providers" />
        </label>
        <button
          type="button"
          className="secondary"
          onClick={() => setCustomProviderForm(customProviderForm === "add" ? null : "add")}
          aria-expanded={customProviderForm === "add"}
        >
          <Plus size={14} /> Add custom provider
        </button>
      </div>
      {customProviderForm === "add" && (
        <CustomProviderForm
          busy={customProviderBusy}
          onCancel={() => setCustomProviderForm(null)}
          onSaved={(id) => {
            setCustomProviderForm(null);
            void props.onRefresh(id);
          }}
          onSubmit={async (definition) => {
            setCustomProviderBusy(true);
            try {
              return await props.onAddCustomProvider(definition);
            } finally {
              setCustomProviderBusy(false);
            }
          }}
        />
      )}
      {props.providers.length === 0 ? (
        <div className="provider-empty">
          <KeyRound size={22} />
          <strong>No providers available</strong>
          <p>Apple Pi could not load its built-in provider list. Restart the app and try again.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="provider-empty">
          <strong>No matching providers</strong>
          <p>Try a provider name such as DeepSeek.</p>
        </div>
      ) : (
        <div className="provider-list">
          {visible.map((provider) => {
            const checking = activity[provider.id] === "checking";
            const diagnostic = feedback[provider.id] ?? (provider.status === "error" ? provider.diagnostics[0] : undefined);
            const providerModels = props.models.filter((model) => model.provider === provider.id);
            const canManage =
              provider.authMethods.includes("api_key") && (provider.credentialSource === "apple_pi" || provider.credentialSource === "unavailable");
            const isEditing = editing === provider.id;
            const isOAuthActive = oauthLogin?.providerId === provider.id;
            const isCustom = isCustomProvider(provider.id, props.customProviders);
            const isEditingCustomProvider = customProviderForm === provider.id;
            return (
              <article className={`provider-card status-${checking ? "checking" : provider.status}`} key={provider.id} aria-busy={checking}>
                <div className="provider-summary">
                  <div className="provider-name">
                    <span className="provider-logo" aria-hidden="true">
                      {provider.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <h3>{provider.name}</h3>
                      <p>{provider.id}</p>
                    </div>
                  </div>
                  <span className="provider-status">
                    {checking ? (
                      <>
                        <CircleDashed size={13} />
                        Checking
                      </>
                    ) : provider.status === "connected" ? (
                      <>
                        <Check size={13} />
                        Connected
                      </>
                    ) : provider.status === "error" ? (
                      <>
                        <AlertCircle size={13} />
                        Error
                      </>
                    ) : (
                      "Disconnected"
                    )}
                  </span>
                </div>
                <dl className="provider-meta">
                  <div>
                    <dt>Credential</dt>
                    <dd>{sourceLabels[provider.credentialSource]}</dd>
                  </div>
                  <div>
                    <dt>Models</dt>
                    <dd>{providerModels.length || provider.availableModelCount}</dd>
                  </div>
                </dl>
                {diagnostic && (
                  <p className={`provider-diagnostic ${diagnostic.severity}`} role={diagnostic.severity === "error" ? "alert" : "status"}>
                    {diagnostic.message}
                  </p>
                )}
                {isOAuthActive && oauthLogin && (
                  <OAuthLoginPanel
                    state={oauthLogin}
                    onCancel={cancelOAuthLogin}
                    onSubmit={submitOAuthPrompt}
                    onPromptValueChange={(value) => setOauthLogin((current) => (current ? { ...current, promptValue: value } : current))}
                  />
                )}
                {isEditing && canManage && (
                  <form
                    className="provider-key-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void connect(provider);
                    }}
                  >
                    <label htmlFor={`provider-key-${provider.id}`}>{provider.status === "connected" ? "Replacement API key" : "API key"}</label>
                    <div>
                      <input
                        id={`provider-key-${provider.id}`}
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={apiKeys[provider.id] ?? ""}
                        onChange={(event) => setApiKeys((current) => ({ ...current, [provider.id]: event.target.value }))}
                        disabled={checking}
                        autoFocus
                      />
                      <button type="submit" disabled={checking || !apiKeys[provider.id]?.trim()}>
                        {provider.status === "connected" ? "Replace key" : "Connect"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setEditing(null);
                          setApiKeys((current) => ({ ...current, [provider.id]: "" }));
                        }}
                        disabled={checking}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
                {isEditingCustomProvider && (
                  <CustomProviderForm
                    initial={props.customProviders.find((definition) => definition.id === provider.id)}
                    busy={customProviderBusy}
                    onCancel={() => setCustomProviderForm(null)}
                    onSaved={(id) => {
                      setCustomProviderForm(null);
                      void props.onRefresh(id);
                    }}
                    onSubmit={async (definition) => {
                      setCustomProviderBusy(true);
                      try {
                        return await props.onUpdateCustomProvider(provider.id, definition);
                      } finally {
                        setCustomProviderBusy(false);
                      }
                    }}
                  />
                )}
                {provider.status === "connected" && providerModels.length > 0 && (
                  <div className="provider-models">
                    <label htmlFor={`provider-model-${provider.id}`}>Default model</label>
                    <select
                      id={`provider-model-${provider.id}`}
                      value={props.defaultModel?.provider === provider.id ? `${props.defaultModel.provider}::${props.defaultModel.modelId}` : ""}
                      onChange={(event) => {
                        const [, modelId] = event.target.value.split("::");
                        if (modelId) void props.onDefaultModel({ provider: provider.id, modelId });
                      }}
                    >
                      <option value="">Choose a model</option>
                      {providerModels.map((model) => (
                        <option key={model.modelId} value={`${provider.id}::${model.modelId}`}>
                          {model.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {provider.status === "connected" && providerModels.length === 0 && (
                  <div className="provider-no-models">
                    <strong>No models available yet.</strong>
                    <span>Verify the credential, then retry loading this provider’s models.</span>
                  </div>
                )}
                <div className="provider-actions">
                  {canManage && !isEditing && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(provider.id);
                        setFeedback((current) => ({ ...current, [provider.id]: undefined }));
                      }}
                      disabled={checking}
                    >
                      {provider.status === "connected" ? "Replace key" : "Connect"}
                    </button>
                  )}
                  {canStartOAuthLogin(provider) && !isOAuthActive && (
                    <button type="button" onClick={() => startOAuthLogin(provider)} disabled={checking}>
                      Sign in
                    </button>
                  )}
                  {provider.status === "connected" && (
                    <button type="button" className="secondary" onClick={() => void run(provider.id, () => props.onVerify(provider.id))} disabled={checking}>
                      Verify
                    </button>
                  )}
                  {provider.status === "connected" && provider.credentialSource === "apple_pi" && (
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => void run(provider.id, () => props.onDisconnect(provider.id), true)}
                      disabled={checking}
                    >
                      Disconnect
                    </button>
                  )}
                  {isCustom && !isEditingCustomProvider && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setCustomProviderForm(provider.id);
                        setFeedback((current) => ({ ...current, [provider.id]: undefined }));
                      }}
                      disabled={checking}
                    >
                      <Pencil size={13} /> Edit
                    </button>
                  )}
                  {isCustom && (
                    <button type="button" className="danger-button" onClick={() => void removeCustomProvider(provider)} disabled={checking}>
                      <X size={13} /> Remove
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
