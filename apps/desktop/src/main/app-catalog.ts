import path from "node:path";

export interface ModelRef {
  provider: string;
  modelId: string;
}
export interface WorkspaceRecord {
  path: string;
  name: string;
}
interface CatalogData {
  workspaces: WorkspaceRecord[];
  defaultModel?: ModelRef;
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
      if (value) this.data = JSON.parse(value) as CatalogData;
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
  async setDefaultModel(model: ModelRef): Promise<void> {
    this.data.defaultModel = model;
    await this.persist();
  }
  async clearDefaultModel(): Promise<void> {
    delete this.data.defaultModel;
    await this.persist();
  }
  private persist(): Promise<void> {
    return this.storage.write(`${JSON.stringify(this.data, null, 2)}\n`);
  }
}
