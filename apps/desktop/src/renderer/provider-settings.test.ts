import { describe, expect, it } from "vitest";
import { firstActionableDiagnostic, modelUnavailable } from "./src/provider-settings.js";

const model = (provider: string, modelId: string) => ({ provider, modelId, name: modelId });

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
