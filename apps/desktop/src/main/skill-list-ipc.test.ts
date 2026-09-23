import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `apps/desktop/src/main/index.ts` is Electron's real entry point: importing
// it runs `app.whenReady()`/window/updater/crash-reporter side effects that
// aren't practical to stand up under vitest (see the complete absence of any
// other `index.test.ts` in this directory). This mirrors the source-text
// contract style already used for the preload script and the renderer's
// skill settings panel (see preload-contract.test.ts and ui-contract.test.ts)
// to pin down the exact fix for issue #68: "Global (user-scope) skills are
// invisible in Settings unless a workspace is open".
const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("skill:list IPC handler", () => {
  it("forwards explicit scopes and adds cwd only when a workspace is open", () => {
    expect(source).toContain('handle("skill:list", (_event, value: unknown) => {');
    expect(source).toContain('return host.request("skill.list", { ...(workspacePath ? { cwd: workspacePath } : {}), scopes });');
    expect(source).toContain("requireWorkspaceForProjectScopes(scopes);");
  });

  it("supports user disabled-skill bookkeeping without a workspace while guarding project requests", () => {
    expect(source).toContain('handle("skill:listDisabled", (_event, value: unknown) => {');
    expect(source).toContain('return host.request("skill.listDisabled", { ...(workspacePath ? { cwd: workspacePath } : {}), scopes });');
  });
});
