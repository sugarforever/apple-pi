import { describe, expect, it } from "vitest";
import { firstActionableDiagnostic } from "./src/provider-settings.js";

describe("provider onboarding state helpers", () => {
  it("prioritizes actionable errors over warnings", () => {
    expect(firstActionableDiagnostic({ diagnostics: [
      { code: "secure_storage_unavailable", severity: "warning", message: "Session only" },
      { code: "authentication_failed", severity: "error", message: "Rejected", action: "reconnect" },
    ] })?.message).toBe("Rejected");
  });

  it("preserves useful non-error storage feedback", () => {
    expect(firstActionableDiagnostic({ diagnostics: [
      { code: "secure_storage_unavailable", severity: "warning", message: "Session only" },
    ] })?.code).toBe("secure_storage_unavailable");
  });
});
