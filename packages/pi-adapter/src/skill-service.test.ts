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

import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { createSkillResourceLoader, PiSkillService } from "./skill-service.js";

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

  it("reuses the active session's loader instance for a matching cwd instead of scanning again", async () => {
    const activeLoader = { getSkills: vi.fn(() => ({ skills: [userSkill], diagnostics: [] })) };
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
    const activeLoader = { getSkills: vi.fn(() => ({ skills: [userSkill], diagnostics: [] })) };
    const service = new PiSkillService();
    service.setActiveLoader({ cwd: "/workspace-a", loader: activeLoader });

    await service.list("/workspace-b");

    expect(activeLoader.getSkills).not.toHaveBeenCalled();
    expect(DefaultResourceLoaderMock).toHaveBeenCalledExactlyOnceWith({ cwd: "/workspace-b", agentDir: "/fake/agent-dir" });
  });

  it("falls back to a fresh loader once the active session is cleared", async () => {
    const activeLoader = { getSkills: vi.fn(() => ({ skills: [], diagnostics: [] })) };
    const service = new PiSkillService();
    service.setActiveLoader({ cwd: "/workspace", loader: activeLoader });
    service.setActiveLoader(undefined);

    await service.list("/workspace");

    expect(activeLoader.getSkills).not.toHaveBeenCalled();
    expect(DefaultResourceLoaderMock).toHaveBeenCalledExactlyOnceWith({ cwd: "/workspace", agentDir: "/fake/agent-dir" });
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
    cwd = join(root, "workspace");
    await mkdir(agentDir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    pi.getAgentDir.mockReturnValue(agentDir);
    // Wire the mocked DefaultResourceLoader's getSkills() to the real scanner
    // pointed at the real managed roots, so a `list()` call after a lifecycle
    // mutation reflects what actually landed on disk, not canned data.
    // `loadSkillsFromDir`'s own `source` param only controls `sourceInfo.source`
    // (kept as "auto" here so mapPiSkill reports `managed: true`, matching what
    // the real DefaultResourceLoader tags for these two roots); it does not set
    // `sourceInfo.scope` for an arbitrary source string, so each root's results
    // are re-tagged with the right scope before mapping, mirroring what the
    // real loader's own metadata pass does for these exact directories.
    const scanScoped = (dir: string, scope: "user" | "project") => {
      const scanned = loadSkillsFromDir({ dir, source: "auto" });
      return {
        skills: scanned.skills.map((skill) => ({ ...skill, sourceInfo: { ...skill.sourceInfo, scope } })),
        diagnostics: scanned.diagnostics,
      };
    };
    pi.resourceLoaderGetSkills.mockImplementation(() => {
      const user = scanScoped(join(agentDir, "skills"), "user");
      const project = scanScoped(join(cwd, ".pi", "skills"), "project");
      return { skills: [...user.skills, ...project.skills], diagnostics: [...user.diagnostics, ...project.diagnostics] };
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

  function disabledRoot(scope: "user" | "project"): string {
    return `${managedRoot(scope)}-disabled`;
  }

  describe("install", () => {
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
});
