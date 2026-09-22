import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pi = vi.hoisted(() => ({
  resourceLoaderReload: vi.fn(async () => {}),
  resourceLoaderGetSkills: vi.fn(() => ({ skills: [] as unknown[], diagnostics: [] as unknown[] })),
  getAgentDir: vi.fn(() => "/fake/agent-dir"),
}));

const DefaultResourceLoaderMock = vi.hoisted(() =>
  vi.fn(function (this: unknown, options: { cwd: string; agentDir: string }) {
    return { options, reload: pi.resourceLoaderReload, getSkills: pi.resourceLoaderGetSkills };
  }),
);

// `DefaultResourceLoader` and `getAgentDir` stay controllable test doubles (constructing
// a real DefaultResourceLoader pulls in settings.json/extension loading unrelated to this
// module); everything else — notably `loadSkillsFromDir` and `CONFIG_DIR_NAME` — comes
// from the real SDK, so install/setEnabled/remove exercise Pi's actual skill-directory
// validation and naming rules against real temp-directory fixtures below.
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, DefaultResourceLoader: DefaultResourceLoaderMock, getAgentDir: pi.getAgentDir };
});

// Only `homedir()` is faked here (list()'s no-cwd path uses it to find
// `~/.agents/skills`, the second global skills root — see scanUserScopeSkills
// in skill-service.ts); `tmpdir()` stays real since fixtures below still need
// real temp directories on disk.
const os = vi.hoisted(() => ({ homedir: vi.fn(() => "/fake/home") }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: os.homedir };
});

import { loadSkillsFromDir, type ResourceDiagnostic, type Skill } from "@earendil-works/pi-coding-agent";
import { createSkillResourceLoader, PiSkillService, type SkillResourceLoader } from "./skill-service.js";

describe("createSkillResourceLoader", () => {
  beforeEach(() => {
    DefaultResourceLoaderMock.mockClear();
    pi.resourceLoaderReload.mockClear();
    pi.resourceLoaderGetSkills.mockClear();
    pi.getAgentDir.mockReturnValue("/fake/agent-dir");
  });

  it("constructs a DefaultResourceLoader for the given cwd and the default agent dir, then reloads it", async () => {
    await createSkillResourceLoader("/workspace");

    expect(DefaultResourceLoaderMock).toHaveBeenCalledExactlyOnceWith({ cwd: "/workspace", agentDir: "/fake/agent-dir" });
    expect(pi.resourceLoaderReload).toHaveBeenCalledOnce();
  });
});

describe("PiSkillService", () => {
  beforeEach(() => {
    DefaultResourceLoaderMock.mockClear();
    pi.resourceLoaderReload.mockClear();
    pi.resourceLoaderGetSkills.mockReset().mockReturnValue({ skills: [], diagnostics: [] });
    pi.getAgentDir.mockReturnValue("/fake/agent-dir");
  });

  const userSkill = {
    name: "pdf-forms",
    description: "Fill and flatten PDF forms.",
    filePath: "/home/jane/.pi/agent/skills/pdf-forms/SKILL.md",
    baseDir: "/home/jane/.pi/agent/skills/pdf-forms",
    sourceInfo: { path: "/home/jane/.pi/agent/skills/pdf-forms", source: "auto", scope: "user" as const, origin: "top-level" as const },
    disableModelInvocation: false,
  };
  const projectSkill = {
    name: "release-notes",
    description: "Draft release notes from recent commits.",
    filePath: "/repo/.pi/skills/release-notes/SKILL.md",
    baseDir: "/repo/.pi/skills/release-notes",
    sourceInfo: { path: "/repo/.pi/skills/release-notes", source: "auto", scope: "project" as const, origin: "top-level" as const },
    disableModelInvocation: false,
  };
  const collisionDiagnostic = {
    type: "collision" as const,
    message: "Skill 'pdf-forms' is defined in two locations; the project copy wins.",
    collision: {
      resourceType: "skill" as const,
      name: "pdf-forms",
      winnerPath: "/repo/.pi/skills/pdf-forms/SKILL.md",
      loserPath: "/home/jane/.pi/agent/skills/pdf-forms/SKILL.md",
    },
  };
  const missingDescriptionDiagnostic = {
    type: "warning" as const,
    message: "Skill 'legacy-helper' is missing a description and was skipped.",
    path: "/repo/.pi/skills/legacy-helper/SKILL.md",
  };

  it("constructs and reloads a fresh loader for a cwd with no active session, and maps its skills and diagnostics", async () => {
    pi.resourceLoaderGetSkills.mockReturnValue({ skills: [userSkill, projectSkill], diagnostics: [collisionDiagnostic] });
    const service = new PiSkillService();

    const catalog = await service.list("/workspace");

    expect(DefaultResourceLoaderMock).toHaveBeenCalledExactlyOnceWith({ cwd: "/workspace", agentDir: "/fake/agent-dir" });
    expect(pi.resourceLoaderReload).toHaveBeenCalledOnce();
    expect(catalog).toEqual({
      skills: [
        {
          name: "pdf-forms",
          description: "Fill and flatten PDF forms.",
          scope: "user",
          path: userSkill.filePath,
          disableModelInvocation: false,
          managed: true,
        },
        {
          name: "release-notes",
          description: "Draft release notes from recent commits.",
          scope: "project",
          path: projectSkill.filePath,
          disableModelInvocation: false,
          managed: true,
        },
      ],
      diagnostics: [
        {
          type: "collision",
          message: collisionDiagnostic.message,
          collision: {
            resourceType: "skill",
            name: "pdf-forms",
            winnerPath: collisionDiagnostic.collision.winnerPath,
            loserPath: collisionDiagnostic.collision.loserPath,
          },
        },
      ],
    });
  });

  it("passes through a missing-description diagnostic for a skill Pi itself drops, without a matching skill entry", async () => {
    pi.resourceLoaderGetSkills.mockReturnValue({ skills: [], diagnostics: [missingDescriptionDiagnostic] });
    const service = new PiSkillService();

    const catalog = await service.list("/workspace");

    expect(catalog).toEqual({ skills: [], diagnostics: [missingDescriptionDiagnostic] });
  });

  it("filters the session catalog to project scope when requested", async () => {
    pi.resourceLoaderGetSkills.mockReturnValue({ skills: [userSkill, projectSkill], diagnostics: [] });
    const service = new PiSkillService();

    expect((await service.list("/workspace", ["project"])).skills.map((skill) => skill.scope)).toEqual(["project"]);
  });

  it("rejects project-scope resolution without workspace context", async () => {
    const service = new PiSkillService();

    await expect(service.list(undefined, ["project"])).rejects.toThrow("Project-scoped skills require a workspace");
  });

  it("reuses the active session's loader instance for a matching cwd instead of scanning again", async () => {
    const activeLoader = { getSkills: vi.fn(() => ({ skills: [userSkill], diagnostics: [] })), reload: vi.fn(async () => {}) };
    const service = new PiSkillService();
    service.setActiveLoader({ cwd: "/workspace", loader: activeLoader });

    const catalog = await service.list("/workspace");

    expect(DefaultResourceLoaderMock).not.toHaveBeenCalled();
    expect(activeLoader.getSkills).toHaveBeenCalledOnce();
    expect(catalog.skills).toEqual([
      { name: "pdf-forms", description: "Fill and flatten PDF forms.", scope: "user", path: userSkill.filePath, disableModelInvocation: false, managed: true },
    ]);
  });

  it("falls back to a fresh loader when the requested cwd does not match the active session", async () => {
    const activeLoader = { getSkills: vi.fn(() => ({ skills: [userSkill], diagnostics: [] })), reload: vi.fn(async () => {}) };
    const service = new PiSkillService();
    service.setActiveLoader({ cwd: "/workspace-a", loader: activeLoader });

    await service.list("/workspace-b");

    expect(activeLoader.getSkills).not.toHaveBeenCalled();
    expect(DefaultResourceLoaderMock).toHaveBeenCalledExactlyOnceWith({ cwd: "/workspace-b", agentDir: "/fake/agent-dir" });
  });

  it("falls back to a fresh loader once the active session is cleared", async () => {
    const activeLoader = { getSkills: vi.fn(() => ({ skills: [], diagnostics: [] })), reload: vi.fn(async () => {}) };
    const service = new PiSkillService();
    service.setActiveLoader({ cwd: "/workspace", loader: activeLoader });
    service.setActiveLoader(undefined);

    await service.list("/workspace");

    expect(activeLoader.getSkills).not.toHaveBeenCalled();
    expect(DefaultResourceLoaderMock).toHaveBeenCalledExactlyOnceWith({ cwd: "/workspace", agentDir: "/fake/agent-dir" });
  });
});

// --- list() with no cwd at all (global/user-scope skills, no workspace) ----
//
// Settings is an app-level surface reachable with zero workspaces open, so
// list() must be able to report user-scope skills without ever needing a
// project `cwd` to construct a DefaultResourceLoader with (see issue #68:
// "Global (user-scope) skills are invisible in Settings unless a workspace
// is open"). These exercise real filesystem fixtures under both global
// roots, with only `homedir()` faked (see the module mock above).
describe("PiSkillService.list() with no cwd", () => {
  let root: string;

  beforeEach(async () => {
    DefaultResourceLoaderMock.mockClear();
    pi.resourceLoaderReload.mockClear();
    pi.resourceLoaderGetSkills.mockReset();
    root = await mkdtemp(join(tmpdir(), "apple-pi-skill-global-"));
    const agentDir = join(root, "agent-dir");
    const home = join(root, "home");
    await mkdir(agentDir, { recursive: true });
    await mkdir(home, { recursive: true });
    pi.getAgentDir.mockReturnValue(agentDir);
    os.homedir.mockReturnValue(home);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeSkillFixture(dir: string, name: string, description: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\nDo the thing.\n`, "utf8");
  }

  it("returns an empty catalog when neither global skills root exists yet, without constructing a DefaultResourceLoader", async () => {
    const service = new PiSkillService();

    const catalog = await service.list();

    expect(catalog).toEqual({ skills: [], diagnostics: [] });
    expect(DefaultResourceLoaderMock).not.toHaveBeenCalled();
    expect(pi.resourceLoaderReload).not.toHaveBeenCalled();
  });

  it("lists skills from ~/.pi/agent/skills as user-scope and managed, with no project-scope discovery at all", async () => {
    const agentDir = pi.getAgentDir();
    await writeSkillFixture(join(agentDir, "skills", "pdf-forms"), "pdf-forms", "Fill and flatten PDF forms.");
    const service = new PiSkillService();

    const catalog = await service.list();

    expect(catalog).toEqual({
      skills: [
        {
          name: "pdf-forms",
          description: "Fill and flatten PDF forms.",
          scope: "user",
          path: join(agentDir, "skills", "pdf-forms", "SKILL.md"),
          disableModelInvocation: false,
          managed: true,
        },
      ],
      diagnostics: [],
    });
    expect(DefaultResourceLoaderMock).not.toHaveBeenCalled();
  });

  it("also lists skills from ~/.agents/skills as user-scope and managed", async () => {
    const home = os.homedir();
    await writeSkillFixture(join(home, ".agents", "skills", "release-notes"), "release-notes", "Draft release notes from recent commits.");
    const service = new PiSkillService();

    const catalog = await service.list();

    expect(catalog.skills).toEqual([
      {
        name: "release-notes",
        description: "Draft release notes from recent commits.",
        scope: "user",
        path: join(home, ".agents", "skills", "release-notes", "SKILL.md"),
        disableModelInvocation: false,
        managed: true,
      },
    ]);
  });

  it("merges both global roots and flags a same-name collision, the pi-agent root winning", async () => {
    const agentDir = pi.getAgentDir();
    const home = os.homedir();
    await writeSkillFixture(join(agentDir, "skills", "pdf-forms"), "pdf-forms", "The pi-agent copy.");
    await writeSkillFixture(join(home, ".agents", "skills", "pdf-forms"), "pdf-forms", "The .agents copy.");
    const service = new PiSkillService();

    const catalog = await service.list();

    expect(catalog.skills).toEqual([expect.objectContaining({ name: "pdf-forms", description: "The pi-agent copy.", scope: "user" })]);
    expect(catalog.diagnostics).toEqual([expect.objectContaining({ type: "collision" })]);
  });

  it("never falls back to the active session's loader, even when one is set for some cwd", async () => {
    const activeLoader = { getSkills: vi.fn(() => ({ skills: [], diagnostics: [] })), reload: vi.fn(async () => {}) };
    const service = new PiSkillService();
    service.setActiveLoader({ cwd: "/workspace", loader: activeLoader });

    await service.list();

    expect(activeLoader.getSkills).not.toHaveBeenCalled();
  });
});

// --- Lifecycle (install / setEnabled / remove) -----------------------------
//
// These exercise real filesystem behavior: a real temp directory stands in for
// the agent dir (user scope) and the project cwd (project scope), and
// `loadSkillsFromDir` is the real SDK implementation (see the module mock
// above), so both Pi's own validation rules and this module's atomic
// copy/move/rollback logic run for real rather than through a mock.
describe("PiSkillService lifecycle", () => {
  let root: string;
  let cwd: string;

  beforeEach(async () => {
    DefaultResourceLoaderMock.mockClear();
    pi.resourceLoaderReload.mockClear();
    pi.resourceLoaderGetSkills.mockReset();
    root = await mkdtemp(join(tmpdir(), "apple-pi-skill-lifecycle-"));
    const agentDir = join(root, "agent-dir");
    const home = join(root, "home");
    cwd = join(root, "workspace");
    await mkdir(agentDir, { recursive: true });
    await mkdir(home, { recursive: true });
    // A `.git` marker stops the real loader's ancestor walk for project-scope
    // `.agents/skills` roots at the workspace itself (see
    // collectAncestorAgentsSkillDirs in the SDK's core/package-manager.ts),
    // so nothing above the temp workspace is ever scanned or written to.
    await mkdir(join(cwd, ".git"), { recursive: true });
    pi.getAgentDir.mockReturnValue(agentDir);
    os.homedir.mockReturnValue(home);
    // Wire the mocked DefaultResourceLoader's getSkills() to the real scanner
    // pointed at the real managed roots — all four of them, in the real
    // loader's own order (project `.pi`, project `.agents`, user `.pi`, user
    // `.agents`), with a same-name collision resolved first-wins exactly as
    // the real loader does — so a `list()` call after a lifecycle mutation
    // reflects what actually landed on disk, not canned data.
    // `loadSkillsFromDir`'s own `source` param only controls `sourceInfo.source`
    // (kept as "auto" here so mapPiSkill reports `managed: true`, matching what
    // the real DefaultResourceLoader tags for these roots); it does not set
    // `sourceInfo.scope` for an arbitrary source string, so each root's results
    // are re-tagged with the right scope before mapping, mirroring what the
    // real loader's own metadata pass does for these exact directories.
    pi.resourceLoaderGetSkills.mockImplementation(() => {
      const roots: Array<[string, "user" | "project"]> = [
        [join(cwd, ".pi", "skills"), "project"],
        [join(cwd, ".agents", "skills"), "project"],
        [join(agentDir, "skills"), "user"],
        [join(home, ".agents", "skills"), "user"],
      ];
      const byName = new Map<string, Skill>();
      const diagnostics: ResourceDiagnostic[] = [];
      for (const [dir, scope] of roots) {
        const scanned = loadSkillsFromDir({ dir, source: "auto" });
        diagnostics.push(...scanned.diagnostics);
        for (const skill of scanned.skills) {
          const existing = byName.get(skill.name);
          if (existing) {
            diagnostics.push({
              type: "collision",
              message: `name "${skill.name}" collision`,
              path: skill.filePath,
              collision: { resourceType: "skill", name: skill.name, winnerPath: existing.filePath, loserPath: skill.filePath },
            });
            continue;
          }
          byName.set(skill.name, { ...skill, sourceInfo: { ...skill.sourceInfo, scope } });
        }
      }
      return { skills: Array.from(byName.values()), diagnostics };
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeSkillFixture(dir: string, options: { name?: string; description?: string; disableModelInvocation?: boolean } = {}): Promise<void> {
    await mkdir(dir, { recursive: true });
    const frontmatter = [
      "---",
      options.name !== undefined ? `name: ${options.name}` : undefined,
      options.description !== undefined ? `description: ${JSON.stringify(options.description)}` : undefined,
      options.disableModelInvocation ? "disable-model-invocation: true" : undefined,
      "---",
    ]
      .filter((line) => line !== undefined)
      .join("\n");
    await writeFile(join(dir, "SKILL.md"), `${frontmatter}\n\nDo the thing.\n`, "utf8");
  }

  function managedRoot(scope: "user" | "project"): string {
    return scope === "user" ? join(root, "agent-dir", "skills") : join(cwd, ".pi", "skills");
  }

  // The second auto-discovered root of each scope: the cross-agent-tool
  // `.agents/skills` convention directory (under the home dir for user scope,
  // under the workspace for project scope).
  function agentsRoot(scope: "user" | "project"): string {
    return scope === "user" ? join(root, "home", ".agents", "skills") : join(cwd, ".agents", "skills");
  }

  function disabledRoot(scope: "user" | "project"): string {
    return `${managedRoot(scope)}-disabled`;
  }

  describe("install", () => {
    it("keeps same-name user and project skills distinct when both scopes are requested", async () => {
      await writeSkillFixture(join(managedRoot("user"), "release"), { name: "release", description: "User release workflow." });
      await writeSkillFixture(join(managedRoot("project"), "release"), { name: "release", description: "Project release workflow." });
      const service = new PiSkillService();

      const catalog = await service.list(cwd, ["user", "project"]);

      expect(catalog.skills.map((skill) => [skill.scope, skill.name, skill.description])).toEqual([
        ["user", "release", "User release workflow."],
        ["project", "release", "Project release workflow."],
      ]);
    });

    it("supports the complete user-scope lifecycle without a workspace", async () => {
      const source = join(root, "candidate");
      await writeSkillFixture(source, { name: "pdf-forms", description: "Fill and flatten PDF forms." });
      const service = new PiSkillService();

      expect((await service.install(source, "user")).diagnostics).toEqual([]);
      expect((await service.list(undefined, ["user"])).skills.map((skill) => skill.name)).toEqual(["pdf-forms"]);
      expect((await service.setEnabled("pdf-forms", "user", undefined, false)).diagnostics).toEqual([]);
      expect((await service.listDisabled(undefined, ["user"])).map((skill) => skill.name)).toEqual(["pdf-forms"]);
      expect((await service.remove("pdf-forms", "user")).diagnostics).toEqual([]);
      expect(await service.listDisabled(undefined, ["user"])).toEqual([]);
    });

    it.each(["user", "project"] as const)("copies a valid skill directory into the %s managed root and it appears in list()", async (scope) => {
      const source = join(root, "candidate");
      await writeSkillFixture(source, { name: "pdf-forms", description: "Fill and flatten PDF forms." });
      const service = new PiSkillService();

      const result = await service.install(source, scope, cwd);

      expect(result.diagnostics).toEqual([]);
      expect(result.skill).toEqual({
        name: "pdf-forms",
        description: "Fill and flatten PDF forms.",
        scope,
        path: join(managedRoot(scope), "pdf-forms", "SKILL.md"),
        disableModelInvocation: false,
        managed: true,
      });
      expect(existsSync(join(managedRoot(scope), "pdf-forms", "SKILL.md"))).toBe(true);

      const catalog = await service.list(cwd);
      expect(catalog.skills).toContainEqual(result.skill);
    });

    it("rejects a directory whose SKILL.md is missing a description, and writes nothing to the managed root", async () => {
      const source = join(root, "candidate");
      await writeSkillFixture(source, { name: "legacy-helper" });
      const service = new PiSkillService();

      const result = await service.install(source, "user", cwd);

      expect(result.skill).toBeUndefined();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(existsSync(managedRoot("user"))).toBe(false);
    });

    it("rejects a name collision with an existing managed skill in the same scope, without overwriting it", async () => {
      await writeSkillFixture(join(managedRoot("user"), "pdf-forms"), { name: "pdf-forms", description: "Original description." });
      const source = join(root, "candidate");
      await writeSkillFixture(source, { name: "pdf-forms", description: "A different skill entirely." });
      const service = new PiSkillService();

      const result = await service.install(source, "user", cwd);

      expect(result.skill).toBeUndefined();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      const preserved = await readFile(join(managedRoot("user"), "pdf-forms", "SKILL.md"), "utf8");
      expect(preserved).toContain("Original description.");
    });
  });

  describe("setEnabled", () => {
    it("moves a managed skill out of discovery when disabled, and back when re-enabled", async () => {
      await writeSkillFixture(join(managedRoot("project"), "release-notes"), { name: "release-notes", description: "Draft release notes." });
      const service = new PiSkillService();

      const disableResult = await service.setEnabled("release-notes", "project", cwd, false);
      expect(disableResult.diagnostics).toEqual([]);
      expect(disableResult.skill?.name).toBe("release-notes");

      expect(existsSync(join(managedRoot("project"), "release-notes"))).toBe(false);
      const afterDisable = await service.list(cwd);
      expect(afterDisable.skills.find((skill) => skill.name === "release-notes")).toBeUndefined();
      const rescan = loadSkillsFromDir({ dir: managedRoot("project"), source: "auto" });
      expect(rescan.skills.find((skill) => skill.name === "release-notes")).toBeUndefined();
      expect(existsSync(join(disabledRoot("project"), "release-notes", "SKILL.md"))).toBe(true);

      const enableResult = await service.setEnabled("release-notes", "project", cwd, true);
      expect(enableResult.diagnostics).toEqual([]);
      expect(existsSync(join(managedRoot("project"), "release-notes", "SKILL.md"))).toBe(true);
      const afterEnable = await service.list(cwd);
      expect(afterEnable.skills.find((skill) => skill.name === "release-notes")).toBeDefined();
    });

    it("rejects disabling a skill Apple Pi does not manage, with no filesystem change", async () => {
      const unmanagedDir = join(cwd, "vendor", "unmanaged-skill");
      await writeSkillFixture(unmanagedDir, { name: "unmanaged-skill", description: "Not ours to touch." });
      pi.resourceLoaderGetSkills.mockReturnValue({
        skills: [
          {
            name: "unmanaged-skill",
            description: "Not ours to touch.",
            filePath: join(unmanagedDir, "SKILL.md"),
            baseDir: unmanagedDir,
            sourceInfo: { path: unmanagedDir, source: "local", scope: "project", origin: "top-level" },
            disableModelInvocation: false,
          },
        ],
        diagnostics: [],
      });
      const service = new PiSkillService();

      const result = await service.setEnabled("unmanaged-skill", "project", cwd, false);

      expect(result.skill).toBeUndefined();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(existsSync(join(unmanagedDir, "SKILL.md"))).toBe(true);
      expect(existsSync(disabledRoot("project"))).toBe(false);
    });

    // Pi scans two auto-discovered roots per scope (see managedSkillsRoots in
    // skill-service.ts). These pin down what that means for enable/disable.
    describe("across both auto-discovered roots of a scope", () => {
      it.each(["user", "project"] as const)(
        "disables a %s-scope skill that lives only in the .agents root into that root's own sibling holding directory, and restores it there rather than relocating it",
        async (scope) => {
          await writeSkillFixture(join(agentsRoot(scope), "math-coach"), { name: "math-coach", description: "Tutor, don't just answer." });
          const service = new PiSkillService();

          const disableResult = await service.setEnabled("math-coach", scope, cwd, false);
          expect(disableResult.diagnostics).toEqual([]);
          expect(disableResult.skill?.path).toBe(join(`${agentsRoot(scope)}-disabled`, "math-coach", "SKILL.md"));
          expect(existsSync(join(agentsRoot(scope), "math-coach"))).toBe(false);
          expect(existsSync(disabledRoot(scope))).toBe(false);
          expect((await service.list(cwd)).skills.find((skill) => skill.name === "math-coach")).toBeUndefined();
          expect((await service.listDisabled(cwd)).map((skill) => skill.name)).toEqual(["math-coach"]);

          const enableResult = await service.setEnabled("math-coach", scope, cwd, true);
          expect(enableResult.diagnostics).toEqual([]);
          expect(enableResult.skill?.path).toBe(join(agentsRoot(scope), "math-coach", "SKILL.md"));
          expect(existsSync(join(managedRoot(scope), "math-coach"))).toBe(false);
          expect(existsSync(join(`${agentsRoot(scope)}-disabled`, "math-coach"))).toBe(false);
          expect((await service.list(cwd)).skills.find((skill) => skill.name === "math-coach")?.path).toBe(join(agentsRoot(scope), "math-coach", "SKILL.md"));
        },
      );

      // The reported bug: the same skill name in both roots. Pi reports the
      // `.pi` copy as the collision winner and hides the `.agents` copy, so
      // moving only the winner made the loser surface — still "Enabled" — and
      // a second disable then collided on the single per-scope holding path.
      it("disables every same-named copy in one go so a hidden collision loser cannot surface, and re-enables each back into its own root", async () => {
        await writeSkillFixture(join(managedRoot("user"), "agents-sdk"), { name: "agents-sdk", description: "The pi-agent copy." });
        await writeSkillFixture(join(agentsRoot("user"), "agents-sdk"), { name: "agents-sdk", description: "The .agents copy." });
        const service = new PiSkillService();
        expect((await service.list(cwd)).skills.filter((skill) => skill.name === "agents-sdk")).toEqual([
          expect.objectContaining({ description: "The pi-agent copy.", path: join(managedRoot("user"), "agents-sdk", "SKILL.md") }),
        ]);

        const disableResult = await service.setEnabled("agents-sdk", "user", cwd, false);
        expect(disableResult.diagnostics).toEqual([]);
        expect(disableResult.skill).toEqual(
          expect.objectContaining({ description: "The pi-agent copy.", path: join(disabledRoot("user"), "agents-sdk", "SKILL.md") }),
        );
        expect(existsSync(join(managedRoot("user"), "agents-sdk"))).toBe(false);
        expect(existsSync(join(agentsRoot("user"), "agents-sdk"))).toBe(false);
        expect(existsSync(join(disabledRoot("user"), "agents-sdk", "SKILL.md"))).toBe(true);
        expect(existsSync(join(`${agentsRoot("user")}-disabled`, "agents-sdk", "SKILL.md"))).toBe(true);
        // Nothing named agents-sdk is discoverable any more, from either root.
        expect((await service.list(cwd)).skills.find((skill) => skill.name === "agents-sdk")).toBeUndefined();
        // And the disabled list reports it once, not once per root.
        expect((await service.listDisabled(cwd)).map((skill) => skill.path)).toEqual([join(disabledRoot("user"), "agents-sdk", "SKILL.md")]);

        const enableResult = await service.setEnabled("agents-sdk", "user", cwd, true);
        expect(enableResult.diagnostics).toEqual([]);
        expect(enableResult.skill?.path).toBe(join(managedRoot("user"), "agents-sdk", "SKILL.md"));
        expect(await readFile(join(managedRoot("user"), "agents-sdk", "SKILL.md"), "utf8")).toContain("The pi-agent copy.");
        expect(await readFile(join(agentsRoot("user"), "agents-sdk", "SKILL.md"), "utf8")).toContain("The .agents copy.");
        expect(existsSync(join(disabledRoot("user"), "agents-sdk"))).toBe(false);
        expect(existsSync(join(`${agentsRoot("user")}-disabled`, "agents-sdk"))).toBe(false);
        expect(await service.listDisabled(cwd)).toEqual([]);
      });

      it("refuses to disable when any copy's holding path is already occupied, naming that path and leaving every copy in place", async () => {
        await writeSkillFixture(join(managedRoot("user"), "agents-sdk"), { name: "agents-sdk", description: "The pi-agent copy." });
        await writeSkillFixture(join(agentsRoot("user"), "agents-sdk"), { name: "agents-sdk", description: "The .agents copy." });
        // Something unrelated already sitting where the .agents copy would go.
        const occupied = join(`${agentsRoot("user")}-disabled`, "agents-sdk");
        await writeSkillFixture(occupied, { name: "agents-sdk", description: "An older, stranded copy." });
        const service = new PiSkillService();

        const result = await service.setEnabled("agents-sdk", "user", cwd, false);

        expect(result.skill).toBeUndefined();
        expect(result.diagnostics).toEqual([
          {
            type: "error",
            message: `Apple Pi could not move "agents-sdk": something already exists at "${occupied}".`,
            path: join(agentsRoot("user"), "agents-sdk"),
          },
        ]);
        expect(existsSync(join(managedRoot("user"), "agents-sdk", "SKILL.md"))).toBe(true);
        expect(existsSync(join(agentsRoot("user"), "agents-sdk", "SKILL.md"))).toBe(true);
        expect(existsSync(join(disabledRoot("user"), "agents-sdk"))).toBe(false);
        expect(await readFile(join(occupied, "SKILL.md"), "utf8")).toContain("An older, stranded copy.");
      });

      it("preserves a skill's nesting below its root across a disable/enable round trip", async () => {
        await writeSkillFixture(join(agentsRoot("user"), "cloudflare", "wrangler"), { name: "wrangler", description: "Nested under a group directory." });
        const service = new PiSkillService();

        const disableResult = await service.setEnabled("wrangler", "user", cwd, false);
        expect(disableResult.diagnostics).toEqual([]);
        expect(existsSync(join(`${agentsRoot("user")}-disabled`, "cloudflare", "wrangler", "SKILL.md"))).toBe(true);

        const enableResult = await service.setEnabled("wrangler", "user", cwd, true);
        expect(enableResult.diagnostics).toEqual([]);
        expect(existsSync(join(agentsRoot("user"), "cloudflare", "wrangler", "SKILL.md"))).toBe(true);
        expect(existsSync(join(`${agentsRoot("user")}-disabled`, "cloudflare", "wrangler"))).toBe(false);
      });
    });
  });

  describe("listDisabled", () => {
    it("returns an empty list when nothing is disabled and the holding directories don't exist yet", async () => {
      const service = new PiSkillService();

      expect(await service.listDisabled(cwd)).toEqual([]);
    });

    it("lists skills sitting in each scope's disabled holding directory, reporting them as disabled regardless of their own frontmatter", async () => {
      await writeSkillFixture(join(managedRoot("user"), "pdf-forms"), { name: "pdf-forms", description: "Fill and flatten PDF forms." });
      await writeSkillFixture(join(managedRoot("project"), "release-notes"), { name: "release-notes", description: "Draft release notes." });
      const service = new PiSkillService();
      await service.setEnabled("pdf-forms", "user", cwd, false);
      await service.setEnabled("release-notes", "project", cwd, false);

      const disabled = await service.listDisabled(cwd);

      expect(disabled).toEqual(
        expect.arrayContaining([
          {
            name: "pdf-forms",
            description: "Fill and flatten PDF forms.",
            scope: "user",
            path: join(disabledRoot("user"), "pdf-forms", "SKILL.md"),
            disableModelInvocation: true,
            managed: true,
          },
          {
            name: "release-notes",
            description: "Draft release notes.",
            scope: "project",
            path: join(disabledRoot("project"), "release-notes", "SKILL.md"),
            disableModelInvocation: true,
            managed: true,
          },
        ]),
      );
      expect(disabled).toHaveLength(2);
    });

    // The on-disk state the original single-root bug left behind: one copy
    // already in `~/.pi/agent/skills-disabled`, the other still live in
    // `~/.agents/skills`. Pi discovers the live copy, so the skill *is*
    // enabled; reporting the held copy as well gave the UI two same-keyed
    // rows ("Enabled" and "Disabled") for one skill.
    it("omits a held copy whose name list() still discovers from another root, and a disable/enable cycle from there heals both copies", async () => {
      await writeSkillFixture(join(disabledRoot("user"), "hyperframes"), { name: "hyperframes", description: "The held pi-agent copy." });
      await writeSkillFixture(join(agentsRoot("user"), "hyperframes"), { name: "hyperframes", description: "The live .agents copy." });
      const service = new PiSkillService();

      expect((await service.list(cwd)).skills.map((skill) => skill.name)).toEqual(["hyperframes"]);
      expect(await service.listDisabled(cwd)).toEqual([]);

      const disableResult = await service.setEnabled("hyperframes", "user", cwd, false);
      expect(disableResult.diagnostics).toEqual([]);
      expect((await service.list(cwd)).skills).toEqual([]);
      expect((await service.listDisabled(cwd)).map((skill) => skill.path)).toEqual([join(disabledRoot("user"), "hyperframes", "SKILL.md")]);
      expect(existsSync(join(`${agentsRoot("user")}-disabled`, "hyperframes", "SKILL.md"))).toBe(true);

      const enableResult = await service.setEnabled("hyperframes", "user", cwd, true);
      expect(enableResult.diagnostics).toEqual([]);
      expect(await readFile(join(managedRoot("user"), "hyperframes", "SKILL.md"), "utf8")).toContain("The held pi-agent copy.");
      expect(await readFile(join(agentsRoot("user"), "hyperframes", "SKILL.md"), "utf8")).toContain("The live .agents copy.");
      expect(await service.listDisabled(cwd)).toEqual([]);
    });

    it("still reports a held copy when the same name is discovered only in the other scope", async () => {
      await writeSkillFixture(join(disabledRoot("user"), "release-notes"), { name: "release-notes", description: "Held user copy." });
      await writeSkillFixture(join(managedRoot("project"), "release-notes"), { name: "release-notes", description: "Live project copy." });
      const service = new PiSkillService();

      expect((await service.listDisabled(cwd)).map((skill) => [skill.name, skill.scope])).toEqual([["release-notes", "user"]]);
    });

    it("never overlaps with list(), mirroring exactly what disabling a skill removed from Pi's own discovery", async () => {
      await writeSkillFixture(join(managedRoot("user"), "pdf-forms"), { name: "pdf-forms", description: "Fill and flatten PDF forms." });
      const service = new PiSkillService();
      await service.setEnabled("pdf-forms", "user", cwd, false);

      const catalog = await service.list(cwd);
      const disabled = await service.listDisabled(cwd);

      expect(catalog.skills.find((skill) => skill.name === "pdf-forms")).toBeUndefined();
      expect(disabled).toHaveLength(1);
      expect(disabled[0]?.name).toBe("pdf-forms");
    });
  });

  describe("remove", () => {
    it("deletes a managed skill's directory entirely", async () => {
      await writeSkillFixture(join(managedRoot("user"), "pdf-forms"), { name: "pdf-forms", description: "Fill and flatten PDF forms." });
      const service = new PiSkillService();

      const result = await service.remove("pdf-forms", "user", cwd);

      expect(result.diagnostics).toEqual([]);
      expect(result.skill?.name).toBe("pdf-forms");
      expect(existsSync(join(managedRoot("user"), "pdf-forms"))).toBe(false);
    });

    it("deletes a disabled skill from its holding directory, reporting the SKILL.md path it was deleted from", async () => {
      await writeSkillFixture(join(agentsRoot("user"), "math-coach"), { name: "math-coach", description: "Tutor, don't just answer." });
      const service = new PiSkillService();
      await service.setEnabled("math-coach", "user", cwd, false);

      const result = await service.remove("math-coach", "user", cwd);

      expect(result.diagnostics).toEqual([]);
      expect(result.skill?.path).toBe(join(`${agentsRoot("user")}-disabled`, "math-coach", "SKILL.md"));
      expect(existsSync(join(`${agentsRoot("user")}-disabled`, "math-coach"))).toBe(false);
      expect(await service.listDisabled(cwd)).toEqual([]);
    });

    it("deletes only the copy whose path the catalog showed, so a hidden same-named copy surfaces with its own path instead of being deleted unseen", async () => {
      await writeSkillFixture(join(managedRoot("user"), "agents-sdk"), { name: "agents-sdk", description: "The pi-agent copy." });
      await writeSkillFixture(join(agentsRoot("user"), "agents-sdk"), { name: "agents-sdk", description: "The .agents copy." });
      const service = new PiSkillService();

      const result = await service.remove("agents-sdk", "user", cwd);

      expect(result.diagnostics).toEqual([]);
      expect(result.skill?.path).toBe(join(managedRoot("user"), "agents-sdk", "SKILL.md"));
      expect(existsSync(join(managedRoot("user"), "agents-sdk"))).toBe(false);
      expect(existsSync(join(agentsRoot("user"), "agents-sdk", "SKILL.md"))).toBe(true);
      expect((await service.list(cwd)).skills.find((skill) => skill.name === "agents-sdk")?.path).toBe(join(agentsRoot("user"), "agents-sdk", "SKILL.md"));
    });

    it("rejects removing a skill Apple Pi does not manage, with no filesystem change", async () => {
      const unmanagedDir = join(cwd, "vendor", "unmanaged-skill");
      await writeSkillFixture(unmanagedDir, { name: "unmanaged-skill", description: "Not ours to touch." });
      pi.resourceLoaderGetSkills.mockReturnValue({
        skills: [
          {
            name: "unmanaged-skill",
            description: "Not ours to touch.",
            filePath: join(unmanagedDir, "SKILL.md"),
            baseDir: unmanagedDir,
            sourceInfo: { path: unmanagedDir, source: "local", scope: "project", origin: "top-level" },
            disableModelInvocation: false,
          },
        ],
        diagnostics: [],
      });
      const service = new PiSkillService();

      const result = await service.remove("unmanaged-skill", "project", cwd);

      expect(result.skill).toBeUndefined();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(existsSync(join(unmanagedDir, "SKILL.md"))).toBe(true);
    });
  });

  describe("active session loader freshness", () => {
    // DefaultResourceLoader.getSkills() is a pure cached getter (see the real
    // SDK's core/resource-loader.ts: `getSkills() { return { skills: this.skills,
    // diagnostics: this.skillDiagnostics }; }`) — it never re-scans on its own,
    // only reload() does. Every other test above never attaches an active loader,
    // so list() always takes the "no active session" path in createSkillResourceLoader
    // and gets a brand new, freshly-reloaded loader on every call, masking this: with a
    // real open session, a mutation must reload that session's own cached loader, or
    // both the next list() and the mutation methods' own catalog-based lookups (which
    // call list() internally, see disable()/remove() above) keep reporting pre-mutation
    // state — exactly what made a disable click look like it did nothing, then fail
    // outright on a second click with "something already exists at the destination".
    function statefulLoader(): SkillResourceLoader & { reload: ReturnType<typeof vi.fn> } {
      const scan = (): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } => {
        const user = loadSkillsFromDir({ dir: managedRoot("user"), source: "auto" });
        const project = loadSkillsFromDir({ dir: managedRoot("project"), source: "auto" });
        return {
          skills: [
            ...user.skills.map((skill) => ({ ...skill, sourceInfo: { ...skill.sourceInfo, scope: "user" as const } })),
            ...project.skills.map((skill) => ({ ...skill, sourceInfo: { ...skill.sourceInfo, scope: "project" as const } })),
          ],
          diagnostics: [...user.diagnostics, ...project.diagnostics],
        };
      };
      let snapshot = scan();
      return {
        getSkills: () => snapshot,
        reload: vi.fn(async () => {
          snapshot = scan();
        }),
      };
    }

    it("reloads the active session's loader after setEnabled, so a repeat toggle sees the change instead of colliding with it", async () => {
      await writeSkillFixture(join(managedRoot("user"), "pdf-forms"), { name: "pdf-forms", description: "Fill and flatten PDF forms." });
      const loader = statefulLoader();
      const service = new PiSkillService();
      service.setActiveLoader({ cwd, loader });

      const disableResult = await service.setEnabled("pdf-forms", "user", cwd, false);
      expect(disableResult.diagnostics).toEqual([]);
      expect(loader.reload).toHaveBeenCalled();

      // Before the fix, this still returned "pdf-forms" (the loader's stale
      // cached snapshot), which is exactly what the desktop UI re-fetches to
      // refresh itself after a mutation — the visible "nothing happened" bug.
      const afterDisable = await service.list(cwd);
      expect(afterDisable.skills.map((skill) => skill.name)).toEqual([]);

      // Before the fix, the stale list() above made the UI think a second
      // click was still needed; it sent the same setEnabled(..., false) again
      // and that collided with the now-already-moved directory ("Apple Pi
      // could not move \"pdf-forms\": something already exists at the
      // destination") instead of a clean, expected "not found" — the skill
      // genuinely isn't in the discoverable/enabled set anymore, so this is
      // the correct outcome now, not a bug: the crash-like collision message
      // is what's fixed, not this diagnostic itself.
      const repeatDisable = await service.setEnabled("pdf-forms", "user", cwd, false);
      expect(repeatDisable.diagnostics).toEqual([{ type: "error", message: 'No skill named "pdf-forms" was found in the user scope.' }]);
    });

    it("reloads the active session's loader after install and remove too", async () => {
      const source = join(root, "candidate");
      await writeSkillFixture(source, { name: "release-notes", description: "Draft release notes." });
      const loader = statefulLoader();
      const service = new PiSkillService();
      service.setActiveLoader({ cwd, loader });

      const installResult = await service.install(source, "project", cwd);
      expect(installResult.diagnostics).toEqual([]);
      expect((await service.list(cwd)).skills.map((skill) => skill.name)).toEqual(["release-notes"]);

      const removeResult = await service.remove("release-notes", "project", cwd);
      expect(removeResult.diagnostics).toEqual([]);
      expect((await service.list(cwd)).skills.map((skill) => skill.name)).toEqual([]);
    });
  });
});
