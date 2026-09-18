import { describe, expect, it } from "vitest";
import type { SkillItem, SkillOperationResult } from "@apple-pi/protocol";
import { diagnosticRole, firstActionableSkillDiagnostic, isSkillEnabled, mergeSkillLists, projectScopeNotice, skillKey } from "./src/skill-settings.js";

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

// See issue #68 ("Global (user-scope) skills are invisible in Settings
// unless a workspace is open"): once user-scope skills show up with no
// workspace open, the panel should say *why* project-scoped ones are
// missing instead of silently showing fewer skills.
describe("projectScopeNotice", () => {
  it("is undefined once project-scope management is available (a workspace is open)", () => {
    expect(projectScopeNotice(true)).toBeUndefined();
  });

  it("explains that project-scoped skills aren't shown or manageable with no workspace open", () => {
    expect(projectScopeNotice(false)).toBe(
      "No workspace is open, so project-scoped skills aren't shown or manageable here. Only skills installed for this user are listed below.",
    );
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

describe("mergeSkillLists", () => {
  it("sorts enabled and disabled skills into one list by name, then scope", () => {
    const merged = mergeSkillLists(
      [skill({ name: "zip", scope: "user" }), skill({ name: "alpha", scope: "project" })],
      [skill({ name: "alpha", scope: "user", disableModelInvocation: true })],
    );
    expect(merged.map((item) => skillKey(item.scope, item.name))).toEqual(["project:alpha", "user:alpha", "user:zip"]);
  });

  it("renders one row per scope+name, the discovered (enabled) entry winning over a disabled one with the same key", () => {
    const enabled = skill({ name: "hyperframes", path: "/home/user/.agents/skills/hyperframes/SKILL.md" });
    const held = skill({ name: "hyperframes", path: "/home/user/.pi/agent/skills-disabled/hyperframes/SKILL.md", disableModelInvocation: true });

    const merged = mergeSkillLists([enabled], [held]);

    expect(merged).toEqual([enabled]);
  });
});
