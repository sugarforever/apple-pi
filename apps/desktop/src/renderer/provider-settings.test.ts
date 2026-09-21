import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CustomProviderDefinition, ProviderItem } from "@apple-pi/protocol";
import {
  canStartOAuthLogin,
  filterProviders,
  firstActionableDiagnostic,
  isCustomProvider,
  modelUnavailable,
  nextSelectedProviderId,
} from "./src/provider-settings.js";

const model = (provider: string, modelId: string) => ({ provider, modelId, name: modelId });

const provider = (overrides: Partial<ProviderItem> = {}): ProviderItem => ({
  id: "openai-codex",
  name: "OpenAI Codex",
  authMethods: ["oauth"],
  status: "disconnected",
  credentialSource: "unavailable",
  availableModelCount: 0,
  diagnostics: [],
  ...overrides,
});

describe("provider onboarding state helpers", () => {
  it("prioritizes actionable errors over warnings", () => {
    expect(
      firstActionableDiagnostic({
        diagnostics: [
          { code: "secure_storage_unavailable", severity: "warning", message: "Session only" },
          { code: "authentication_failed", severity: "error", message: "Rejected", action: "reconnect" },
        ],
      })?.message,
    ).toBe("Rejected");
  });

  it("preserves useful non-error storage feedback", () => {
    expect(firstActionableDiagnostic({ diagnostics: [{ code: "secure_storage_unavailable", severity: "warning", message: "Session only" }] })?.code).toBe(
      "secure_storage_unavailable",
    );
  });
});

describe("modelUnavailable", () => {
  it("is false when there is no reference model to check", () => {
    expect(modelUnavailable([model("openai", "gpt-5")], undefined)).toBe(false);
  });

  it("is false when the referenced model is still present", () => {
    expect(modelUnavailable([model("openai", "gpt-5")], { provider: "openai", modelId: "gpt-5" })).toBe(false);
  });

  it("is true when the referenced model's provider was removed", () => {
    expect(modelUnavailable([model("anthropic", "claude")], { provider: "openai", modelId: "gpt-5" })).toBe(true);
  });

  it("is false for an empty catalog so a transient load never triggers a false recovery", () => {
    expect(modelUnavailable([], { provider: "openai", modelId: "gpt-5" })).toBe(false);
  });
});

describe("canStartOAuthLogin", () => {
  it("offers sign-in for a disconnected oauth-capable provider that has no api_key method at all", () => {
    expect(canStartOAuthLogin(provider())).toBe(true);
  });

  it("does not offer sign-in once the provider is already connected", () => {
    expect(canStartOAuthLogin(provider({ status: "connected", credentialSource: "oauth" }))).toBe(false);
  });

  it("does not offer sign-in for a provider without an oauth auth method", () => {
    expect(canStartOAuthLogin(provider({ authMethods: ["api_key"] }))).toBe(false);
  });

  it("still offers sign-in for a provider that supports both api_key and oauth", () => {
    expect(canStartOAuthLogin(provider({ authMethods: ["api_key", "oauth"] }))).toBe(true);
  });
});

describe("isCustomProvider", () => {
  const customDefinition: CustomProviderDefinition = {
    id: "my-local-llm",
    name: "My Local LLM",
    baseUrl: "https://localhost:8080/v1",
    api: "openai-completions",
    models: [{ id: "local-model-a" }],
  };

  it("is true for a provider Apple Pi's custom-provider store manages", () => {
    expect(isCustomProvider("my-local-llm", [customDefinition])).toBe(true);
  });

  it("is false for a built-in provider not present in the custom-provider list", () => {
    expect(isCustomProvider("openai", [customDefinition])).toBe(false);
  });

  it("is false when there are no custom providers at all", () => {
    expect(isCustomProvider("my-local-llm", [])).toBe(false);
  });
});

describe("provider browser", () => {
  const customDefinition: CustomProviderDefinition = {
    id: "local",
    name: "Local Models",
    baseUrl: "https://localhost:8080/v1",
    api: "openai-completions",
    models: [{ id: "local-model" }],
  };
  const providers = [
    provider({ id: "anthropic", name: "Anthropic", authMethods: ["api_key"], status: "connected", credentialSource: "apple_pi" }),
    provider({ id: "openai", name: "OpenAI", authMethods: ["api_key"] }),
    provider({ id: "local", name: "Local Models", authMethods: ["api_key"] }),
  ];

  it("searches by provider identity and applies connected/custom filters", () => {
    expect(filterProviders(providers, [customDefinition], "OPEN", "all").map((item) => item.id)).toEqual(["openai"]);
    expect(filterProviders(providers, [customDefinition], "", "connected").map((item) => item.id)).toEqual(["anthropic"]);
    expect(filterProviders(providers, [customDefinition], "", "custom").map((item) => item.id)).toEqual(["local"]);
  });

  it("keeps the selected provider across refreshes and falls back after removal", () => {
    expect(nextSelectedProviderId(providers, "openai")).toBe("openai");
    expect(
      nextSelectedProviderId(
        providers.filter((item) => item.id !== "openai"),
        "openai",
      ),
    ).toBe("anthropic");
    expect(nextSelectedProviderId([], "openai")).toBeNull();
  });

  it("renders one selectable directory and one busy detail surface", () => {
    const source = readFileSync(new URL("./src/provider-settings.tsx", import.meta.url), "utf8");
    expect(source).toContain('role="listbox"');
    expect(source).toContain("aria-selected={effectiveSelectedProviderId === provider.id}");
    expect(source).toContain('id="provider-detail"');
    expect(source).toContain("aria-busy={checking}");
    expect(source).toContain("disabled={checking}");
    expect(source).not.toContain("className={`provider-card");
  });
});
