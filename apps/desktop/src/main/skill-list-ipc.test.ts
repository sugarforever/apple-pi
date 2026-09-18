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
  it("forwards { cwd: workspacePath } when a workspace is open, and {} (not a hardcoded empty catalog) otherwise", () => {
    expect(source).toContain('handle("skill:list", () => host.request("skill.list", workspacePath ? { cwd: workspacePath } : {}));');
    // The old short-circuit -- which hid user-scope skills too whenever no
    // workspace was open -- must be gone, not just unreachable.
    expect(source).not.toContain("{ skills: [], diagnostics: [] }");
  });

  it("leaves skill:listDisabled's workspace-required short-circuit alone (disabled-holding-directory bookkeeping stays project-session-scoped)", () => {
    expect(source).toContain('handle("skill:listDisabled", () => (workspacePath ? host.request("skill.listDisabled", { cwd: workspacePath }) : []));');
  });
});
