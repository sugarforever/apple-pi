import { describe, expect, it } from "vitest";
import type { SkillItem, SkillOperationResult } from "@apple-pi/protocol";
import {
  diagnosticRole,
  firstActionableSkillDiagnostic,
  groupSkillDiagnostics,
  isSkillEnabled,
  mergeSkillLists,
  projectScopeNotice,
  skillKey,
} from "./src/skill-settings.js";

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

// Catalog-level diagnostics render as one collapsed line per type rather than
// one banner each: a dozen same-shaped "name collision" entries (the same
// skill in both `~/.pi/agent/skills` and `~/.agents/skills`, which Pi resolves
// by itself) were burying the list under red alerts that said nothing new.
describe("groupSkillDiagnostics", () => {
  const collision = (name: string) => ({
    type: "collision" as const,
    message: `name "${name}" collision`,
    path: `/home/user/.agents/skills/${name}/SKILL.md`,
    collision: {
      resourceType: "skill" as const,
      name,
      winnerPath: `/home/user/.pi/agent/skills/${name}/SKILL.md`,
      loserPath: `/home/user/.agents/skills/${name}/SKILL.md`,
    },
  });

  it("is empty when there are no diagnostics", () => {
    expect(groupSkillDiagnostics([])).toEqual([]);
  });

  it("collapses every collision into one headline with a count, keeping which copy won per entry for the expanded view", () => {
    const groups = groupSkillDiagnostics([collision("figma"), collision("wrangler")]);

    expect(groups).toEqual([
      {
        type: "collision",
        headline: "2 skills exist in more than one skills folder; the first copy found is used.",
        items: [
          "figma: using /home/user/.pi/agent/skills/figma/SKILL.md, ignoring /home/user/.agents/skills/figma/SKILL.md",
          "wrangler: using /home/user/.pi/agent/skills/wrangler/SKILL.md, ignoring /home/user/.agents/skills/wrangler/SKILL.md",
        ],
      },
    ]);
  });

  it("orders groups error, then collision, then warning, with singular headlines and each entry's own message and path", () => {
    const groups = groupSkillDiagnostics([
      { type: "warning", message: "Skill body is empty." },
      collision("figma"),
      { type: "error", message: "Missing description.", path: "/home/user/.pi/agent/skills/broken/SKILL.md" },
    ]);

    expect(groups.map((group) => group.type)).toEqual(["error", "collision", "warning"]);
    expect(groups[0]).toEqual({
      type: "error",
      headline: "1 skill could not be loaded.",
      items: ["Missing description. (/home/user/.pi/agent/skills/broken/SKILL.md)"],
    });
    expect(groups[1]?.headline).toBe("1 skill exists in more than one skills folder; the first copy found is used.");
    expect(groups[2]).toEqual({ type: "warning", headline: "1 skill has a warning.", items: ["Skill body is empty."] });
  });
});
