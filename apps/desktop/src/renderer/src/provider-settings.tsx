import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, CircleDashed, KeyRound, Search } from "lucide-react";
import type { HostEvent, ModelItem, ProviderAuthEvent, ProviderDiagnostic, ProviderItem, ProviderOperationResult } from "@apple-pi/protocol";

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
  onConnect(providerId: string, apiKey: string): Promise<ProviderOperationResult>;
  onDisconnect(providerId: string): Promise<ProviderOperationResult>;
  onVerify(providerId: string): Promise<ProviderOperationResult>;
  onRefresh(providerId: string): Promise<void>;
  onDefaultModel(model: { provider: string; modelId: string }): Promise<void>;
  oauth: ProviderOAuthBridge;
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

export function ProviderSettings(props: ProviderSettingsProps) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<Record<string, ProviderActivity>>({});
  const [feedback, setFeedback] = useState<Record<string, ProviderDiagnostic | undefined>>({});
  const [oauthLogin, setOauthLogin] = useState<OAuthLoginState | null>(null);

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
      </div>
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
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
