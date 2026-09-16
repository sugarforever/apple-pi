import { beforeEach, describe, expect, it, vi } from "vitest";

const pi = vi.hoisted(() => ({
  resourceLoaderReload: vi.fn(async () => {}),
  resourceLoaderGetSkills: vi.fn(() => ({ skills: [] as unknown[], diagnostics: [] as unknown[] })),
}));

const DefaultResourceLoaderMock = vi.hoisted(() =>
  vi.fn(function (this: unknown, options: { cwd: string; agentDir: string }) {
    return { options, reload: pi.resourceLoaderReload, getSkills: pi.resourceLoaderGetSkills };
  }),
);

vi.mock("@earendil-works/pi-coding-agent", () => ({
  DefaultResourceLoader: DefaultResourceLoaderMock,
  getAgentDir: () => "/fake/agent-dir",
}));

import { createSkillResourceLoader, PiSkillService } from "./skill-service.js";

describe("createSkillResourceLoader", () => {
  beforeEach(() => {
    DefaultResourceLoaderMock.mockClear();
    pi.resourceLoaderReload.mockClear();
    pi.resourceLoaderGetSkills.mockClear();
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
