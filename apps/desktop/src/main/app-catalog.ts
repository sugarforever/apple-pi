import path from "node:path";
import type { Workspace } from "../shared/pi-api.js";

interface CatalogData {
  workspaces: Workspace[];
}
interface CatalogStorage {
  read(): Promise<string>;
  write(value: string): Promise<void>;
}

export class AppCatalog {
  private data: CatalogData = { workspaces: [] };
  constructor(private readonly storage: CatalogStorage) {}
  async load(): Promise<void> {
    try {
      const value = await this.storage.read();
      // Only workspaces carry over; older builds also stored a default model here.
      if (value) this.data = { workspaces: (JSON.parse(value) as Partial<CatalogData>).workspaces ?? [] };
    } catch {
      this.data = { workspaces: [] };
    }
  }
  snapshot(): CatalogData {
    return structuredClone(this.data);
  }
  async addWorkspace(workspacePath: string): Promise<void> {
    if (!this.data.workspaces.some((item) => item.path === workspacePath))
      this.data.workspaces.push({ path: workspacePath, name: path.basename(workspacePath) || workspacePath });
    await this.persist();
  }
  async removeWorkspace(workspacePath: string): Promise<void> {
    this.data.workspaces = this.data.workspaces.filter((item) => item.path !== workspacePath);
    await this.persist();
  }
  private persist(): Promise<void> {
    return this.storage.write(`${JSON.stringify(this.data, null, 2)}\n`);
  }
}
