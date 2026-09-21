import type { SkillCatalog, SkillDiagnostic, SkillItem, SkillScope } from "@apple-pi/protocol";

export interface ScopedSkillCatalogViewModel<TScope extends SkillScope> {
  scope: TScope;
  enabled: SkillItem[];
  disabled: SkillItem[];
  diagnostics: SkillDiagnostic[];
}

export interface SkillScopeViewModel {
  settings: ScopedSkillCatalogViewModel<"user">;
  workspace?: ScopedSkillCatalogViewModel<"project">;
  // Pi diagnostics do not carry scope. Keep diagnostics whose paths do not
  // establish one separate so consumers can show them without claiming that
  // either the user or the workspace owns them.
  unscopedDiagnostics: SkillDiagnostic[];
}

export interface BuildSkillScopeViewModelInput {
  catalog: SkillCatalog;
  disabled: SkillItem[];
  workspacePath?: string;
  // The workspace whose catalog was loaded. A missing or mismatched value
  // prevents a previous workspace's project catalog from surviving a switch.
  catalogWorkspacePath?: string;
}

function comparablePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/$/, "");
  return /^[A-Z]:\//.test(normalized) ? `${normalized[0]?.toLowerCase()}${normalized.slice(1)}` : normalized;
}

function isWithin(path: string, root: string): boolean {
  const candidate = comparablePath(path);
  const boundary = comparablePath(root);
  return candidate === boundary || candidate.startsWith(`${boundary}/`);
}

function diagnosticPaths(diagnostic: SkillDiagnostic): string[] {
  return [diagnostic.path, diagnostic.collision?.winnerPath, diagnostic.collision?.loserPath].filter((path): path is string => path !== undefined);
}

function diagnosticScope(diagnostic: SkillDiagnostic, skills: SkillItem[], workspacePath?: string): SkillScope | undefined {
  const paths = diagnosticPaths(diagnostic);
  if (paths.length === 0) return undefined;

  const scopes = new Set<SkillScope>();
  for (const path of paths) {
    const matchingSkills = skills.filter((skill) => comparablePath(skill.path) === comparablePath(path));
    for (const skill of matchingSkills) scopes.add(skill.scope);
    if (workspacePath && isWithin(path, workspacePath)) scopes.add("project");
  }
  return scopes.size === 1 ? [...scopes][0] : undefined;
}

export function buildSkillScopeViewModel(input: BuildSkillScopeViewModelInput): SkillScopeViewModel {
  const workspaceIsCurrent = Boolean(input.workspacePath && input.catalogWorkspacePath === input.workspacePath);
  const allSkills = [...input.catalog.skills, ...input.disabled];
  const diagnostics: Record<SkillScope, SkillDiagnostic[]> = { user: [], project: [] };
  const unscopedDiagnostics: SkillDiagnostic[] = [];

  for (const diagnostic of input.catalog.diagnostics) {
    const scope = diagnosticScope(diagnostic, allSkills, workspaceIsCurrent ? input.workspacePath : undefined);
    if (scope) diagnostics[scope]!.push(diagnostic);
    else unscopedDiagnostics.push(diagnostic);
  }

  const scoped = <TScope extends SkillScope>(scope: TScope): ScopedSkillCatalogViewModel<TScope> => ({
    scope,
    enabled: input.catalog.skills.filter((skill) => skill.scope === scope),
    disabled: input.disabled.filter((skill) => skill.scope === scope),
    diagnostics: diagnostics[scope]!,
  });

  return {
    settings: scoped("user"),
    ...(workspaceIsCurrent ? { workspace: scoped("project") } : {}),
    unscopedDiagnostics,
  };
}
