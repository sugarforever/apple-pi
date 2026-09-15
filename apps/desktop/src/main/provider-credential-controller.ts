import { randomUUID } from "node:crypto";
import type { HostCommandPayloads, HostCommandResults, HostCommandType, ProviderItem, ProviderOperationResult } from "@apple-pi/protocol";
import type { CredentialBroker, CredentialStorageIssue } from "./credential-broker.js";
import type { ModelRef } from "./app-catalog.js";

export interface ProviderHost {
  request<Command extends HostCommandType>(type: Command, payload: HostCommandPayloads[Command]): Promise<HostCommandResults[Command]>;
}

export class ProviderCredentialController {
  private readonly provisioned = new Set<string>();

  constructor(
    private readonly credentials: CredentialBroker,
    private readonly host: ProviderHost,
    private readonly operationId: () => string = () => `credential-${randomUUID()}`,
  ) {}

  async list(): Promise<ProviderItem[]> {
    const providers = await this.host.request("provider.list", {});
    const managed = new Set(this.credentials.list().map((item) => item.providerId));
    return providers.map((provider) =>
      managed.has(provider.id)
        ? {
            ...provider,
            status: "connected",
            credentialSource: "apple_pi",
            diagnostics: provider.diagnostics.filter((item) => item.code !== "authentication_required"),
          }
        : provider,
    );
  }

  async connect(input: HostCommandPayloads["provider.connectApiKey"]): Promise<ProviderOperationResult> {
    const result = await this.host.request("provider.connectApiKey", input);
    if (result.provider?.status === "connected" && !result.diagnostics.some((item) => item.severity === "error")) {
      this.provisioned.add(input.providerId);
      await this.credentials.setApiKey(input.providerId, input.apiKey);
      const issue = this.credentials.storageIssue();
      if (issue) result.diagnostics.push(storageWarning(issue));
    } else this.provisioned.delete(input.providerId);
    return result;
  }

  async disconnect(input: HostCommandPayloads["provider.disconnect"]): Promise<ProviderOperationResult> {
    try {
      return await this.host.request("provider.disconnect", input);
    } finally {
      this.provisioned.delete(input.providerId);
      await this.credentials.delete(input.providerId);
    }
  }

  async verify(input: HostCommandPayloads["provider.verify"]): Promise<ProviderOperationResult> {
    await this.provide(input.providerId);
    return this.host.request("provider.verify", input);
  }

  // Unlike an API key, an OAuth credential is never client-managed: `runtime.login()`
  // persists it directly into the agent host's own auth.json (see `PiProviderService`),
  // so there is nothing for `CredentialBroker` to hold or `provide()` before use.
  startOAuthLogin(input: HostCommandPayloads["provider.startOAuthLogin"]): Promise<ProviderOperationResult> {
    return this.host.request("provider.startOAuthLogin", input);
  }

  respondOAuthPrompt(input: HostCommandPayloads["provider.respondOAuthPrompt"]): Promise<HostCommandResults["provider.respondOAuthPrompt"]> {
    return this.host.request("provider.respondOAuthPrompt", input);
  }

  listCustomProviders(): Promise<HostCommandResults["provider.listCustom"]> {
    return this.host.request("provider.listCustom", {});
  }

  addCustomProvider(input: HostCommandPayloads["provider.addCustom"]): Promise<ProviderOperationResult> {
    return this.host.request("provider.addCustom", input);
  }

  updateCustomProvider(input: HostCommandPayloads["provider.updateCustom"]): Promise<ProviderOperationResult> {
    return this.host.request("provider.updateCustom", input);
  }

  // Removing a custom provider deletes its models.json entry entirely, so any
  // stored API key for it becomes meaningless: it can never be provided again
  // once the provider is gone. Purging it here mirrors `disconnect()`'s own
  // `finally` block above, and runs regardless of whether the host-side removal
  // reported an error, so a credential never outlives the provider it belongs to.
  async removeCustomProvider(input: HostCommandPayloads["provider.removeCustom"]): Promise<ProviderOperationResult> {
    try {
      return await this.host.request("provider.removeCustom", input);
    } finally {
      this.provisioned.delete(input.id);
      await this.credentials.delete(input.id);
    }
  }

  async refresh(providerIds: string[] | undefined, input: { operationId: string; timeoutMs: number }) {
    const selected = providerIds ?? this.credentials.list().map((item) => item.providerId);
    await Promise.all(selected.map((providerId) => this.provide(providerId)));
    return this.host.request("model.refresh", { ...input, ...(providerIds ? { providerIds } : {}) });
  }

  // A stored default model can outlive the provider it came from (removed
  // credential, disconnected provider, changed catalog). Callers that are
  // about to act on a default model should resolve it first so a stale
  // reference never silently reaches session creation.
  async resolveDefaultModel(model: ModelRef | undefined): Promise<ModelRef | undefined> {
    if (!model) return undefined;
    const models = await this.host.request("model.list", {});
    return models.some((item) => item.provider === model.provider && item.modelId === model.modelId) ? model : undefined;
  }

  async provide(providerId: string): Promise<boolean> {
    if (this.provisioned.has(providerId)) return true;
    return (
      (await this.credentials.withApiKey(providerId, async (apiKey) => {
        const result = await this.host.request("provider.connectApiKey", {
          providerId,
          apiKey,
          operationId: this.operationId(),
          timeoutMs: 15_000,
        });
        const connected = result.provider?.status === "connected" && !result.diagnostics.some((item) => item.severity === "error");
        if (connected) this.provisioned.add(providerId);
        return connected;
      })) ?? false
    );
  }
}

function storageWarning(issue: CredentialStorageIssue): ProviderOperationResult["diagnostics"][number] {
  return {
    code: "secure_storage_unavailable",
    severity: "warning",
    message:
      issue === "store_quarantined"
        ? "Apple Pi could not read the saved credential store, so it was set aside and this credential is kept for the current session only."
        : "Apple Pi could not use OS-protected credential storage, so this credential is kept for the current session only and is forgotten when you quit.",
  };
}
