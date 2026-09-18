import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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

// The directory root Apple Pi *installs* into for a scope: Pi's own primary
// managed root (`<agentDir>/skills` or `<cwd>/.pi/skills`), which is also the
// first root Pi's DefaultResourceLoader scans for that scope and therefore
// the collision winner should a same-named skill exist elsewhere.
function managedSkillsRoot(scope: SkillScope, cwd: string): string {
  return scope === "user" ? join(getAgentDir(), "skills") : join(cwd, CONFIG_DIR_NAME, "skills");
}

// Mirrors collectAncestorAgentsSkillDirs in the SDK's core/package-manager.ts
// (not exported): `<dir>/.agents/skills` for `cwd` and each ancestor up to and
// including the nearest git repository root (or the filesystem root).
function ancestorAgentsSkillsRoots(cwd: string): string[] {
  const roots: string[] = [];
  let dir = resolve(cwd);
  while (true) {
    roots.push(join(dir, ".agents", "skills"));
    if (existsSync(join(dir, ".git"))) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return roots;
}

// Every directory root Pi's own DefaultResourceLoader treats as `source:
// "auto"` for a scope, in Pi's own scan order (see addAutoDiscoveredResources
// in the SDK's core/package-manager.ts) — i.e. exactly what mapPiSkill
// (mappers.ts) reports as `managed: true`. There is more than one per scope:
// user scope is `<agentDir>/skills` plus the cross-agent-tool `~/.agents/skills`
// convention root; project scope is `<cwd>/.pi/skills` plus `.agents/skills`
// in `cwd` and each ancestor up to the git root (excluding the user one).
// A same-named skill in two of these roots is a Pi collision: the earlier
// root wins and the later copy is silently dropped from discovery — which is
// why setEnabled below acts on *all* copies in the scope, not just the
// winner, or disabling the winner would just surface the loser in its place.
// Apple Pi's install/setEnabled/remove only ever read or write inside these
// roots (or their sibling "-disabled" holding directories, see
// disabledSkillsRoot), never a `settings.json` skills-array entry or a
// package-provided skill.
function managedSkillsRoots(scope: SkillScope, cwd: string): string[] {
  if (scope === "user") return userScopeSkillsRoots();
  const userAgentsRoot = resolve(join(homedir(), ".agents", "skills"));
  return [managedSkillsRoot(scope, cwd), ...ancestorAgentsSkillsRoots(cwd).filter((dir) => resolve(dir) !== userAgentsRoot)];
}

// A holding directory Apple Pi invents itself, sibling to the managed skills
// root it corresponds to (e.g. "<agentDir>/skills-disabled" next to
// "<agentDir>/skills", "~/.agents/skills-disabled" next to
// "~/.agents/skills"). This is not part of Pi's own file layout: it exists
// purely so a "disabled" skill can be moved fully out of Pi's own scanner
// (which only ever walks the managed roots themselves) while Apple Pi retains
// the files and can move them straight back on re-enable. One holding
// directory per root, rather than one per scope, is what lets a skill go back
// to exactly the root it came from, and lets two same-named copies from two
// roots be disabled at once without colliding on a single holding path.
function disabledSkillsRoot(root: string): string {
  return `${root}-disabled`;
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

// A skill unit together with the managed root it was discovered under and its
// location relative to that root's scan directory (`dir` is the root itself
// for an enabled skill, or the root's holding directory for a disabled one),
// so it can be moved between the two while preserving any nesting below the
// root (loadSkillsFromDir scans recursively, so `<root>/group/name/SKILL.md`
// is a valid skill).
interface LocatedSkill {
  skill: Skill;
  unit: { path: string; name: string };
  root: string;
  relativePath: string;
}

// Scans each managed root of a scope (or, with `holding`, each root's
// disabled holding directory) with Pi's own loadSkillsFromDir and returns
// every unit whose skill is named `name`, in Pi's own root order.
function locateSkillUnits(name: string, roots: string[], holding: boolean): LocatedSkill[] {
  const located: LocatedSkill[] = [];
  for (const root of roots) {
    const dir = holding ? disabledSkillsRoot(root) : root;
    const scan = loadSkillsFromDir({ dir, source: holding ? "disabled" : "auto" });
    for (const skill of scan.skills) {
      if (skill.name !== name) continue;
      const unit = skillUnit(skill.filePath);
      const relativePath = relative(dir, unit.path);
      // loadSkillsFromDir only ever reports paths under `dir`, so this is a
      // pure guard against ever computing a destination outside the root.
      if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) continue;
      located.push({ skill, unit, root, relativePath });
    }
  }
  return located;
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

// Moves each located skill unit (see locateSkillUnits) to the same relative
// location under `destinationFor(root)`. Refuses up front (leaving every unit
// untouched) when something already occupies any destination, since that
// would either silently overwrite an unrelated skill or collide two skills
// into one name; this is also what turns a half-applied earlier move (e.g.
// one copy already in its holding directory) into a clear message naming the
// exact path in the way rather than a second, confusing failure.
async function moveSkillUnits(
  located: LocatedSkill[],
  destinationFor: (root: string) => string,
): Promise<{ ok: true; paths: string[] } | { ok: false; message: string; path: string }> {
  const moves = located.map((entry) => ({ from: entry.unit.path, to: join(destinationFor(entry.root), entry.relativePath) }));
  const blocked = moves.find((move) => existsSync(move.to));
  if (blocked) {
    return {
      ok: false,
      message: `Apple Pi could not move "${basename(blocked.from)}": something already exists at "${blocked.to}".`,
      path: blocked.from,
    };
  }
  const paths: string[] = [];
  for (const move of moves) {
    try {
      await mkdir(dirname(move.to), { recursive: true });
      await rename(move.from, move.to);
    } catch (error) {
      return { ok: false, message: `Apple Pi could not move "${basename(move.from)}": ${errorMessage(error)}`, path: move.from };
    }
    paths.push(move.to);
  }
  return { ok: true, paths };
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

// The two directory roots a real Pi session's DefaultResourceLoader treats as
// user-scope, `source: "auto"` skill discovery, entirely independent of any
// project (see addAutoDiscoveredResources in the SDK's core/package-manager.ts,
// and core/trust-manager.ts, which always trusts `~/.agents/skills` regardless
// of project trust): the managed root under Pi's own agent dir, and the
// cross-agent-tool convention root under the home directory.
function userScopeSkillsRoots(): string[] {
  return [join(getAgentDir(), "skills"), join(homedir(), ".agents", "skills")];
}

// Scans just the two global (user-scope) skill roots above directly with
// Pi's own `loadSkillsFromDir`, entirely without constructing a
// `DefaultResourceLoader` -- which requires a real project `cwd` at
// construction time (see `createSkillResourceLoader` above) that simply does
// not exist when Settings is opened with zero workspaces open. Used only by
// `list()` when it is called with no `cwd` at all: project-scope discovery
// is skipped entirely in that case, never partially faked.
function scanUserScopeSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
  const byName = new Map<string, Skill>();
  const diagnostics: ResourceDiagnostic[] = [];
  for (const dir of userScopeSkillsRoots()) {
    const scanned = loadSkillsFromDir({ dir, source: "auto" });
    diagnostics.push(...scanned.diagnostics);
    for (const skill of scanned.skills) {
      const existing = byName.get(skill.name);
      if (existing) {
        diagnostics.push({
          type: "collision",
          message: `Skill "${skill.name}" is defined in more than one global skills root; "${existing.filePath}" wins.`,
          path: skill.filePath,
          collision: { resourceType: "skill", name: skill.name, winnerPath: existing.filePath, loserPath: skill.filePath },
        });
        continue;
      }
      // loadSkillsFromDir's "auto" source string isn't one of the three cases
      // createSkillSourceInfo special-cases ("user"/"project"/"path" -- see
      // that function in the SDK's core/skills.ts), so it falls into the same
      // default branch a real DefaultResourceLoader itself relies on for
      // `managed: true` (source stays "auto"), but leaves `scope` defaulted to
      // "temporary" rather than "user" (mapPiSkill would then wrongly report
      // this as `scope: "project"` -- see this file's lifecycle tests
      // re-tagging scope the same way, for the same reason). Both roots
      // scanned here are user-scope by construction, so force it here too.
      byName.set(skill.name, { ...skill, sourceInfo: { ...skill.sourceInfo, scope: "user" } });
    }
  }
  return { skills: Array.from(byName.values()), diagnostics };
}

export class PiSkillService {
  private active?: ActiveSkillSource;

  // Called by PiSessionService with the exact DefaultResourceLoader instance
  // backing the currently open session, so list() never runs a second,
  // potentially-diverging scan for that same cwd.
  setActiveLoader(active: ActiveSkillSource | undefined): void {
    this.active = active;
  }

  // With a `cwd`, mirrors exactly what a real Pi session would discover there
  // (project + user scope, via a real or shared DefaultResourceLoader -- see
  // createSkillResourceLoader). With no `cwd` at all -- Settings is reachable
  // with zero workspaces open, unlike a real Pi session, which always has one
  // -- project-scope discovery is skipped entirely rather than faked, and
  // only the two global (user-scope) skill roots are scanned directly (see
  // scanUserScopeSkills above), so this path never constructs a
  // DefaultResourceLoader at all.
  async list(cwd?: string): Promise<SkillCatalog> {
    if (cwd === undefined) {
      const { skills, diagnostics } = scanUserScopeSkills();
      return decodeSkillCatalog({ skills: skills.map(mapPiSkill), diagnostics: diagnostics.map(mapPiSkillDiagnostic) });
    }
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

  // Moves a currently-discovered managed skill out to its root's disabled
  // holding directory (see disabledSkillsRoot), so Pi's own scanner stops
  // seeing it while Apple Pi retains it for a later `setEnabled(..., true)`.
  // Every same-named copy in the scope's managed roots moves, not just the
  // collision winner the catalog reports: a copy Pi had been silently
  // dropping as a collision loser would otherwise become the winner the
  // moment the original moved, leaving the skill visibly still enabled.
  private async disable(name: string, scope: SkillScope, cwd: string): Promise<SkillOperationResult> {
    const catalog = await this.list(cwd);
    const found = catalog.skills.find((skill) => skill.name === name && skill.scope === scope);
    if (!found) return decodeSkillOperationResult({ diagnostics: [notFoundDiagnostic(name, scope)] });
    if (!found.managed) return decodeSkillOperationResult({ diagnostics: [notManagedDiagnostic(name, scope, found.path)] });

    const located = locateSkillUnits(name, managedSkillsRoots(scope, cwd), false);
    if (located.length === 0) {
      // The catalog says it is auto-discovered, yet none of the roots this
      // file knows about hold it: refuse rather than guess at a holding
      // directory for a path we cannot map back to a root.
      return decodeSkillOperationResult({
        diagnostics: [skillDiagnostic(`Apple Pi could not find which managed skills directory "${name}" is stored in, so it was left unchanged.`, found.path)],
      });
    }
    const moved = await moveSkillUnits(located, disabledSkillsRoot);
    if (!moved.ok) {
      await this.refreshActiveLoader(cwd);
      return decodeSkillOperationResult({ diagnostics: [skillDiagnostic(moved.message, moved.path)] });
    }

    // Report the copy that had been the collision winner (or the only copy),
    // i.e. the one whose path the catalog showed the user.
    const shown = located.findIndex((entry) => entry.skill.filePath === found.path);
    const index = shown === -1 ? 0 : shown;
    const primary = located[index] as LocatedSkill;
    const skill = skillItemFromUnit({
      name: found.name,
      description: found.description,
      scope,
      unitPath: moved.paths[index] as string,
      wasDirectory: primary.unit.path !== primary.skill.filePath,
      disableModelInvocation: found.disableModelInvocation,
    });
    await this.refreshActiveLoader(cwd);
    return decodeSkillOperationResult({ skill, diagnostics: [] });
  }

  // Moves a previously-disabled skill back from each root's holding directory
  // into that same root, restoring it to Pi's own discovery exactly where it
  // was before; a skill that was in two roots (a Pi collision) goes back to
  // both, so the same copy wins again afterwards.
  private async enable(name: string, scope: SkillScope, cwd: string): Promise<SkillOperationResult> {
    const located = locateSkillUnits(name, managedSkillsRoots(scope, cwd), true);
    if (located.length === 0) {
      return decodeSkillOperationResult({ diagnostics: [skillDiagnostic(`No disabled skill named "${name}" was found in the ${scope} scope.`)] });
    }
    const moved = await moveSkillUnits(located, (root) => root);
    if (!moved.ok) {
      await this.refreshActiveLoader(cwd);
      return decodeSkillOperationResult({ diagnostics: [skillDiagnostic(moved.message, moved.path)] });
    }

    // Roots are in Pi's own scan order, so the first copy is the one Pi's
    // collision handling will report from now on.
    const primary = located[0] as LocatedSkill;
    const skill = skillItemFromUnit({
      name: primary.skill.name,
      description: primary.skill.description,
      scope,
      unitPath: moved.paths[0] as string,
      wasDirectory: primary.unit.path !== primary.skill.filePath,
      disableModelInvocation: primary.skill.disableModelInvocation,
    });
    await this.refreshActiveLoader(cwd);
    return decodeSkillOperationResult({ skill, diagnostics: [] });
  }

  // Reports what is currently sitting in each managed root's disabled holding
  // directory (see disabledSkillsRoot), deliberately kept separate from
  // list()/SkillCatalog rather than folded into it: list() exists specifically
  // to mirror Pi's own discovery exactly (see the class-level comment on
  // list()), and a disabled skill is, by design, invisible to that discovery.
  // This lets a UI show a disabled skill (and offer to re-enable it) without
  // ever breaking that "matches exactly what the session would discover"
  // guarantee for list() itself. Like Pi's own collision handling, a name
  // held in two roots of one scope is reported once, from the earlier root.
  async listDisabled(cwd: string): Promise<SkillItem[]> {
    const scopes: SkillScope[] = ["user", "project"];
    return scopes.flatMap((scope) => {
      const seen = new Set<string>();
      const items: SkillItem[] = [];
      for (const root of managedSkillsRoots(scope, cwd)) {
        const scan = loadSkillsFromDir({ dir: disabledSkillsRoot(root), source: "disabled" });
        for (const found of scan.skills) {
          if (seen.has(found.name)) continue;
          seen.add(found.name);
          // `found.filePath` always points at the SKILL.md file itself; skillUnit
          // resolves it back to the unit's own root (its containing directory for
          // a SKILL.md-wrapped skill, or that same file otherwise), matching what
          // skillItemFromUnit expects as `unitPath` everywhere else in this file.
          const unit = skillUnit(found.filePath);
          items.push(
            skillItemFromUnit({
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
            }),
          );
        }
      }
      return items;
    });
  }

  // Deletes a managed skill, whether it is currently discovered (enabled) or
  // sitting in a disabled holding directory. Unlike setEnabled, this is
  // irreversible, so it deletes only the single unit whose path the catalog
  // (or listDisabled) showed the user; a same-named copy Pi had been hiding
  // as a collision loser then surfaces with its own path and can be removed
  // on its own, rather than being deleted sight unseen.
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

    const disabledFound = locateSkillUnits(name, managedSkillsRoots(scope, cwd), true)[0];
    if (!disabledFound) return decodeSkillOperationResult({ diagnostics: [notFoundDiagnostic(name, scope)] });

    await rm(disabledFound.unit.path, { recursive: true, force: true });
    const skill = skillItemFromUnit({
      name: disabledFound.skill.name,
      description: disabledFound.skill.description,
      scope,
      unitPath: disabledFound.unit.path,
      wasDirectory: disabledFound.unit.path !== disabledFound.skill.filePath,
      disableModelInvocation: disabledFound.skill.disableModelInvocation,
    });
    await this.refreshActiveLoader(cwd);
    return decodeSkillOperationResult({ skill, diagnostics: [] });
  }
}
