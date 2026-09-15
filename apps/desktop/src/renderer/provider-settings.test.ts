import { describe, expect, it } from "vitest";
import type { ProviderItem } from "@apple-pi/protocol";
import { canStartOAuthLogin, firstActionableDiagnostic, modelUnavailable } from "./src/provider-settings.js";

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
