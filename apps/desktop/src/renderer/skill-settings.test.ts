import { describe, expect, it } from "vitest";
import type { SkillItem, SkillOperationResult } from "@apple-pi/protocol";
import { diagnosticRole, firstActionableSkillDiagnostic, isSkillEnabled, skillKey } from "./src/skill-settings.js";

const skill = (overrides: Partial<SkillItem> = {}): SkillItem => ({
  name: "pdf-forms",
  description: "Fill and flatten PDF forms.",
  scope: "user",
  path: "/home/user/.pi/skills/pdf-forms/SKILL.md",
  disableModelInvocation: false,
  managed: true,
  ...overrides,
});

describe("skillKey", () => {
  it("combines scope and name so the same name in different scopes stays distinct", () => {
    expect(skillKey("user", "pdf-forms")).toBe("user:pdf-forms");
    expect(skillKey("project", "pdf-forms")).toBe("project:pdf-forms");
    expect(skillKey("user", "pdf-forms")).not.toBe(skillKey("project", "pdf-forms"));
  });
});

describe("isSkillEnabled", () => {
  it("is true when disableModelInvocation is false", () => {
    expect(isSkillEnabled(skill({ disableModelInvocation: false }))).toBe(true);
  });

  it("is false when disableModelInvocation is true", () => {
    expect(isSkillEnabled(skill({ disableModelInvocation: true }))).toBe(false);
  });
});

describe("diagnosticRole", () => {
  it("treats a warning as a quiet status announcement", () => {
    expect(diagnosticRole("warning")).toBe("status");
  });

  it("treats an error as an alert", () => {
    expect(diagnosticRole("error")).toBe("alert");
  });

  it("treats a collision as an alert", () => {
    expect(diagnosticRole("collision")).toBe("alert");
  });
});

describe("firstActionableSkillDiagnostic", () => {
  it("prefers an error/collision over a mere warning", () => {
    const result: SkillOperationResult = {
      diagnostics: [
        { type: "warning", message: "Missing description defaulted." },
        { type: "error", message: "Name collision with an existing skill." },
      ],
    };
    expect(firstActionableSkillDiagnostic(result)?.message).toBe("Name collision with an existing skill.");
  });

  it("falls back to a warning when nothing more severe is present", () => {
    const result: SkillOperationResult = { diagnostics: [{ type: "warning", message: "Missing description defaulted." }] };
    expect(firstActionableSkillDiagnostic(result)?.message).toBe("Missing description defaulted.");
  });

  it("is undefined when there are no diagnostics at all", () => {
    expect(firstActionableSkillDiagnostic({ diagnostics: [] })).toBeUndefined();
  });
});
