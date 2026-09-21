import { describe, expect, it } from "vitest";
import type { SkillDiagnostic, SkillItem } from "@apple-pi/protocol";
import { buildSkillScopeViewModel } from "./src/skill-scope-view-model.js";

const skill = (scope: SkillItem["scope"], name: string, path: string, disabled = false): SkillItem => ({
  name,
  description: `${name} description`,
  scope,
  path,
  disableModelInvocation: disabled,
  managed: true,
});

describe("buildSkillScopeViewModel", () => {
  it("keeps same-name enabled and disabled skills distinct across scopes", () => {
    const user = skill("user", "release", "/Users/me/.pi/agent/skills/release/SKILL.md");
    const project = skill("project", "release", "/work/app/.pi/skills-disabled/release/SKILL.md", true);
    const view = buildSkillScopeViewModel({
      catalog: { skills: [user], diagnostics: [] },
      disabled: [project],
      workspacePath: "/work/app",
      catalogWorkspacePath: "/work/app",
    });

    expect(view.settings.enabled).toEqual([user]);
    expect(view.settings.disabled).toEqual([]);
    expect(view.workspace?.enabled).toEqual([]);
    expect(view.workspace?.disabled).toEqual([project]);
  });

  it("never exposes project skills without a current open workspace", () => {
    const project = skill("project", "lint", "/work/old/.pi/skills/lint/SKILL.md");
    const catalog = { skills: [project], diagnostics: [] };

    expect(buildSkillScopeViewModel({ catalog, disabled: [] }).workspace).toBeUndefined();
    expect(buildSkillScopeViewModel({ catalog, disabled: [], workspacePath: "/work/new", catalogWorkspacePath: "/work/old" }).workspace).toBeUndefined();
  });

  it("routes diagnostics only when item or workspace paths establish one scope", () => {
    const user = skill("user", "global", "/Users/me/.agents/skills/global/SKILL.md");
    const project = skill("project", "local", "/work/app/.pi/skills/local/SKILL.md");
    const diagnostics: SkillDiagnostic[] = [
      { type: "warning", message: "user warning", path: user.path },
      { type: "error", message: "broken project skill", path: "/work/app/.pi/skills/broken/SKILL.md" },
      { type: "warning", message: "unknown path", path: "/opt/shared/skills/maybe/SKILL.md" },
      { type: "warning", message: "no path" },
    ];
    const view = buildSkillScopeViewModel({
      catalog: { skills: [user, project], diagnostics },
      disabled: [],
      workspacePath: "/work/app",
      catalogWorkspacePath: "/work/app",
    });

    expect(view.settings.diagnostics.map((item) => item.message)).toEqual(["user warning"]);
    expect(view.workspace?.diagnostics.map((item) => item.message)).toEqual(["broken project skill"]);
    expect(view.unscopedDiagnostics.map((item) => item.message)).toEqual(["unknown path", "no path"]);
  });

  it("keeps conflicting collision path evidence unscoped", () => {
    const user = skill("user", "shared", "/Users/me/.agents/skills/shared/SKILL.md");
    const diagnostic: SkillDiagnostic = {
      type: "collision",
      message: "shared collision",
      collision: {
        resourceType: "skill",
        name: "shared",
        winnerPath: user.path,
        loserPath: "/work/app/.pi/skills/shared/SKILL.md",
      },
    };
    const view = buildSkillScopeViewModel({
      catalog: { skills: [user], diagnostics: [diagnostic] },
      disabled: [],
      workspacePath: "/work/app",
      catalogWorkspacePath: "/work/app",
    });

    expect(view.settings.diagnostics).toEqual([]);
    expect(view.workspace?.diagnostics).toEqual([]);
    expect(view.unscopedDiagnostics).toEqual([diagnostic]);
  });
});
