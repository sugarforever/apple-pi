import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { CONFIG_DIR_NAME, DefaultResourceLoader, getAgentDir, loadSkillsFromDir, type ResourceDiagnostic, type Skill } from "@earendil-works/pi-coding-agent";
import {
  decodeSkillCatalog,
  decodeSkillDiagnostic,
  decodeSkillItem,
  decodeSkillOperationResult,
  type SkillCatalog,
  type SkillDiagnostic,
  type SkillItem,
  type SkillOperationResult,
  type SkillScope,
} from "@apple-pi/protocol";
import { mapPiSkill, mapPiSkillDiagnostic } from "./mappers.js";

export interface SkillResourceLoader {
  getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
  reload(): Promise<void>;
}

interface ActiveSkillSource {
  cwd: string;
  loader: SkillResourceLoader;
}

// Mirrors createAgentSession()'s own default resource loader construction
// exactly (see @earendil-works/pi-coding-agent's core/sdk.ts): cwd plus the
// default agentDir, then an explicit reload before first use.
export async function createSkillResourceLoader(cwd: string): Promise<DefaultResourceLoader> {
  const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
  await loader.reload();
  return loader;
}

// The two directory roots Pi's own DefaultResourceLoader treats as `source:
// "auto"` (see getDefaultSourceInfoForPath/addAutoDiscoveredResources in the
// SDK's core/resource-loader.ts and core/package-manager.ts) — i.e. exactly
// what mapPiSkill (mappers.ts) reports as `managed: true`. Apple Pi's
// install/setEnabled/remove below only ever read or write inside these roots
// (or their sibling "-disabled" holding directories, see disabledSkillsRoot),
// never a `settings.json` skills-array entry or a package-provided skill.
function managedSkillsRoot(scope: SkillScope, cwd: string): string {
  return scope === "user" ? join(getAgentDir(), "skills") : join(cwd, CONFIG_DIR_NAME, "skills");
}

// A holding directory Apple Pi invents itself, sibling to the managed skills
// root it corresponds to (e.g. "<agentDir>/skills-disabled" next to
// "<agentDir>/skills"). This is not part of Pi's own file layout: it exists
// purely so a "disabled" skill can be moved fully out of Pi's own scanner
// (which only ever walks the managed root itself) while Apple Pi retains the
// files and can move them straight back on re-enable, preserving the original
// directory/file name so nothing else about the skill needs to be recorded.
function disabledSkillsRoot(scope: SkillScope, cwd: string): string {
  return `${managedSkillsRoot(scope, cwd)}-disabled`;
}

// The on-disk unit that owns a skill's `filePath`, mirroring loadSkillsFromDir's
// own discovery rule (see @earendil-works/pi-coding-agent's core/skills.ts):
// "if a directory contains SKILL.md, treat it as a skill root" means the whole
// parent directory belongs to that skill and moves/deletes as a unit; a skill
// loaded from a bare top-level `<name>.md` file (no SKILL.md wrapper) owns only
// that single file, since its "directory" is the shared managed root itself.
function skillUnit(filePath: string): { path: string; name: string } {
  if (basename(filePath) === "SKILL.md") {
    const directory = dirname(filePath);
    return { path: directory, name: basename(directory) };
  }
  return { path: filePath, name: basename(filePath) };
}

function skillDiagnostic(message: string, path?: string): SkillDiagnostic {
  return decodeSkillDiagnostic({ type: "error", message, ...(path ? { path } : {}) });
}

function notManagedDiagnostic(name: string, scope: SkillScope, path: string): SkillDiagnostic {
  return skillDiagnostic(
    `"${name}" is not managed by Apple Pi in the ${scope} scope (it comes from a settings.json entry or a bundled extension), so it cannot be changed here.`,
    path,
  );
}

function notFoundDiagnostic(name: string, scope: SkillScope): SkillDiagnostic {
  return skillDiagnostic(`No skill named "${name}" was found in the ${scope} scope.`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Moves a skill unit (see skillUnit) into `destinationRoot`, keeping its
// existing basename. Refuses (leaving both sides untouched) when something
// already occupies that name at the destination, since that would either
// silently overwrite an unrelated skill or collide two skills into one name.
async function moveSkillUnit(
  unit: { path: string; name: string },
  destinationRoot: string,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const destination = join(destinationRoot, unit.name);
  if (existsSync(destination)) {
    return { ok: false, message: `Apple Pi could not move "${unit.name}": something already exists at the destination.` };
  }
  await mkdir(destinationRoot, { recursive: true });
  try {
    await rename(unit.path, destination);
  } catch (error) {
    return { ok: false, message: `Apple Pi could not move "${unit.name}": ${errorMessage(error)}` };
  }
  return { ok: true, path: destination };
}

function skillItemFromUnit(input: {
  name: string;
  description: string;
  scope: SkillScope;
  unitPath: string;
  wasDirectory: boolean;
  disableModelInvocation: boolean;
}): SkillItem {
  return decodeSkillItem({
    name: input.name,
    description: input.description,
    scope: input.scope,
    path: input.wasDirectory ? join(input.unitPath, "SKILL.md") : input.unitPath,
    disableModelInvocation: input.disableModelInvocation,
    managed: true,
  });
}

export class PiSkillService {
  private active?: ActiveSkillSource;

  // Called by PiSessionService with the exact DefaultResourceLoader instance
  // backing the currently open session, so list() never runs a second,
  // potentially-diverging scan for that same cwd.
  setActiveLoader(active: ActiveSkillSource | undefined): void {
    this.active = active;
  }

  async list(cwd: string): Promise<SkillCatalog> {
    const loader = this.active?.cwd === cwd ? this.active.loader : await createSkillResourceLoader(cwd);
    const { skills, diagnostics } = loader.getSkills();
    return decodeSkillCatalog({ skills: skills.map(mapPiSkill), diagnostics: diagnostics.map(mapPiSkillDiagnostic) });
  }

  // getSkills() is a pure cached getter (see createSkillResourceLoader's doc
  // comment) — it never re-scans on its own. A mutation below just changed
  // files on disk under `cwd`'s managed roots, so if that cwd's session is
  // the one currently active, its shared loader is now stale: reload it so
  // both the next list() (used internally by disable()/remove() to find a
  // skill's current location, and externally by callers refreshing after a
  // mutation) and the live agent session itself see the change immediately.
  private async refreshActiveLoader(cwd: string): Promise<void> {
    if (this.active?.cwd === cwd) await this.active.loader.reload();
  }

  // Validates `sourcePath` with Pi's own `loadSkillsFromDir` *before* touching
  // the managed root, then copies into a hidden, dot-prefixed staging directory
  // inside the managed root (invisible to Pi's own scanner, which skips
  // dot-prefixed entries — see loadSkillsFromDirInternal in the SDK) and only
  // `rename`s it into its final name once the copy has fully succeeded. That
  // rename is a single filesystem operation, so nothing under the final name
  // is ever visible in a partially-copied state; any failure before it is
  // reached (bad source, existing name, failed copy) leaves the managed root
  // completely untouched, and the staging directory is removed on the way out.
  async install(sourcePath: string, scope: SkillScope, cwd: string): Promise<SkillOperationResult> {
    let sourceStat;
    try {
      sourceStat = await stat(sourcePath);
    } catch {
      return decodeSkillOperationResult({ diagnostics: [skillDiagnostic(`"${sourcePath}" does not exist.`, sourcePath)] });
    }
    if (!sourceStat.isDirectory()) {
      return decodeSkillOperationResult({ diagnostics: [skillDiagnostic(`"${sourcePath}" is not a directory.`, sourcePath)] });
    }

    // Apple Pi never executes or renders skill body content: this only reads
    // frontmatter (name/description/disable-model-invocation) for validation.
    const validated = loadSkillsFromDir({ dir: sourcePath, source: "candidate" });
    if (validated.diagnostics.length > 0) {
      return decodeSkillOperationResult({ diagnostics: validated.diagnostics.map(mapPiSkillDiagnostic) });
    }
    if (validated.skills.length > 1) {
      return decodeSkillOperationResult({
        diagnostics: [skillDiagnostic(`"${sourcePath}" contains ${validated.skills.length} skills; install one skill directory at a time.`, sourcePath)],
      });
    }
    const candidate = validated.skills[0];
    if (!candidate) {
      return decodeSkillOperationResult({ diagnostics: [skillDiagnostic(`No SKILL.md was found under "${sourcePath}".`, sourcePath)] });
    }
    if (basename(candidate.filePath) !== "SKILL.md") {
      return decodeSkillOperationResult({
        diagnostics: [skillDiagnostic(`"${sourcePath}" must be a directory containing a SKILL.md file.`, sourcePath)],
      });
    }

    const root = managedSkillsRoot(scope, cwd);
    const targetPath = join(root, candidate.name);
    if (existsSync(targetPath)) {
      return decodeSkillOperationResult({
        diagnostics: [skillDiagnostic(`A skill named "${candidate.name}" already exists in the ${scope} scope.`, targetPath)],
      });
    }

    await mkdir(root, { recursive: true });
    const staging = join(root, `.install-${randomUUID()}`);
    try {
      await cp(candidate.baseDir, staging, { recursive: true });
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      return decodeSkillOperationResult({ diagnostics: [skillDiagnostic(`Apple Pi could not copy the skill: ${errorMessage(error)}`, sourcePath)] });
    }
    try {
      await rename(staging, targetPath);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      return decodeSkillOperationResult({ diagnostics: [skillDiagnostic(`Apple Pi could not install the skill: ${errorMessage(error)}`, targetPath)] });
    }

    const skill = skillItemFromUnit({
      name: candidate.name,
      description: candidate.description,
      scope,
      unitPath: targetPath,
      wasDirectory: true,
      disableModelInvocation: candidate.disableModelInvocation,
    });
    await this.refreshActiveLoader(cwd);
    return decodeSkillOperationResult({ skill, diagnostics: [] });
  }

  async setEnabled(name: string, scope: SkillScope, cwd: string, enabled: boolean): Promise<SkillOperationResult> {
    return enabled ? this.enable(name, scope, cwd) : this.disable(name, scope, cwd);
  }

  // Moves a currently-discovered managed skill out to its scope's disabled
  // holding directory (see disabledSkillsRoot), so Pi's own scanner stops
  // seeing it while Apple Pi retains it for a later `setEnabled(..., true)`.
  private async disable(name: string, scope: SkillScope, cwd: string): Promise<SkillOperationResult> {
    const catalog = await this.list(cwd);
    const found = catalog.skills.find((skill) => skill.name === name && skill.scope === scope);
    if (!found) return decodeSkillOperationResult({ diagnostics: [notFoundDiagnostic(name, scope)] });
    if (!found.managed) return decodeSkillOperationResult({ diagnostics: [notManagedDiagnostic(name, scope, found.path)] });

    const unit = skillUnit(found.path);
    const moved = await moveSkillUnit(unit, disabledSkillsRoot(scope, cwd));
    if (!moved.ok) return decodeSkillOperationResult({ diagnostics: [skillDiagnostic(moved.message, unit.path)] });

    const skill = skillItemFromUnit({
      name: found.name,
      description: found.description,
      scope,
      unitPath: moved.path,
      wasDirectory: unit.path !== found.path,
      disableModelInvocation: found.disableModelInvocation,
    });
    await this.refreshActiveLoader(cwd);
    return decodeSkillOperationResult({ skill, diagnostics: [] });
  }

  // Moves a previously-disabled skill back from the holding directory into
  // the managed root, restoring it to Pi's own discovery.
  private async enable(name: string, scope: SkillScope, cwd: string): Promise<SkillOperationResult> {
    const disabledDir = disabledSkillsRoot(scope, cwd);
    const scan = loadSkillsFromDir({ dir: disabledDir, source: "disabled" });
    const found = scan.skills.find((skill) => skill.name === name);
    if (!found) return decodeSkillOperationResult({ diagnostics: [skillDiagnostic(`No disabled skill named "${name}" was found in the ${scope} scope.`)] });

    const unit = skillUnit(found.filePath);
    const moved = await moveSkillUnit(unit, managedSkillsRoot(scope, cwd));
    if (!moved.ok) return decodeSkillOperationResult({ diagnostics: [skillDiagnostic(moved.message, unit.path)] });

    const skill = skillItemFromUnit({
      name: found.name,
      description: found.description,
      scope,
      unitPath: moved.path,
      wasDirectory: basename(found.filePath) === "SKILL.md",
      disableModelInvocation: found.disableModelInvocation,
    });
    await this.refreshActiveLoader(cwd);
    return decodeSkillOperationResult({ skill, diagnostics: [] });
  }

  // Reports what is currently sitting in each scope's disabled holding
  // directory (see disabledSkillsRoot), deliberately kept separate from
  // list()/SkillCatalog rather than folded into it: list() exists specifically
  // to mirror Pi's own discovery exactly (see the class-level comment on
  // list()), and a disabled skill is, by design, invisible to that discovery.
  // This lets a UI show a disabled skill (and offer to re-enable it) without
  // ever breaking that "matches exactly what the session would discover"
  // guarantee for list() itself.
  async listDisabled(cwd: string): Promise<SkillItem[]> {
    const scopes: SkillScope[] = ["user", "project"];
    return scopes.flatMap((scope) => {
      const scan = loadSkillsFromDir({ dir: disabledSkillsRoot(scope, cwd), source: "disabled" });
      return scan.skills.map((found) => {
        // `found.filePath` always points at the SKILL.md file itself; skillUnit
        // resolves it back to the unit's own root (its containing directory for
        // a SKILL.md-wrapped skill, or that same file otherwise), matching what
        // skillItemFromUnit expects as `unitPath` everywhere else in this file.
        const unit = skillUnit(found.filePath);
        return skillItemFromUnit({
          name: found.name,
          description: found.description,
          scope,
          unitPath: unit.path,
          wasDirectory: unit.path !== found.filePath,
          // Sitting in Apple Pi's own disabled holding directory *is* the
          // disabled state, regardless of what the skill's own frontmatter
          // says: force this true so the UI's `isSkillEnabled()` check
          // (`!skill.disableModelInvocation`) always reports it as disabled.
          disableModelInvocation: true,
        });
      });
    });
  }

  // Deletes a managed skill entirely, whether it is currently discovered
  // (enabled) or sitting in the disabled holding directory.
  async remove(name: string, scope: SkillScope, cwd: string): Promise<SkillOperationResult> {
    const catalog = await this.list(cwd);
    const found = catalog.skills.find((skill) => skill.name === name && skill.scope === scope);
    if (found) {
      if (!found.managed) return decodeSkillOperationResult({ diagnostics: [notManagedDiagnostic(name, scope, found.path)] });
      const unit = skillUnit(found.path);
      await rm(unit.path, { recursive: true, force: true });
      await this.refreshActiveLoader(cwd);
      return decodeSkillOperationResult({ skill: found, diagnostics: [] });
    }

    const disabledDir = disabledSkillsRoot(scope, cwd);
    const scan = loadSkillsFromDir({ dir: disabledDir, source: "disabled" });
    const disabledFound = scan.skills.find((skill) => skill.name === name);
    if (!disabledFound) return decodeSkillOperationResult({ diagnostics: [notFoundDiagnostic(name, scope)] });

    const unit = skillUnit(disabledFound.filePath);
    await rm(unit.path, { recursive: true, force: true });
    const skill = skillItemFromUnit({
      name: disabledFound.name,
      description: disabledFound.description,
      scope,
      unitPath: disabledFound.filePath,
      wasDirectory: basename(disabledFound.filePath) === "SKILL.md",
      disableModelInvocation: disabledFound.disableModelInvocation,
    });
    await this.refreshActiveLoader(cwd);
    return decodeSkillOperationResult({ skill, diagnostics: [] });
  }
}
