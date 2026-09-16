import { DefaultResourceLoader, getAgentDir, type ResourceDiagnostic, type Skill } from "@earendil-works/pi-coding-agent";
import { decodeSkillCatalog, type SkillCatalog } from "@apple-pi/protocol";
import { mapPiSkill, mapPiSkillDiagnostic } from "./mappers.js";

export interface SkillResourceLoader {
  getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
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
}
