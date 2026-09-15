import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, isAllowedExternalProtocol, isAllowedNavigationUrl, redactUrlForLog } from "./security-policy.js";

const document = readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");

const PACKAGED_ROOT = "file:///Applications/Apple%20Pi.app/Contents/Resources/app.asar/out/renderer";
const packaged = { rendererRootHref: PACKAGED_ROOT };

describe("content security policy", () => {
  it("is enforced by the renderer document", () => {
    // Packaged builds load the renderer over file:, so the meta tag is the only
    // place a policy can be delivered. If it drifts from the constant, the app
    // silently ships a weaker policy than the one under test.
    //
    // The policy value is compared exactly; only the tag's serialization is
    // tolerated, because Prettier decides where the attributes wrap.
    const declared = document.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/)?.[1];
    expect(declared).toBe(CONTENT_SECURITY_POLICY);
  });

  it("denies what the app never needs", () => {
    expect(document).toContain("script-src 'self'");
    expect(document).toContain("object-src 'none'");
    expect(document).toContain("base-uri 'none'");
    expect(document).toContain("form-action 'none'");
  });

  it("never permits eval or remote script origins", () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
    expect(CONTENT_SECURITY_POLICY).toMatch(/script-src 'self';/);
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/https?:\/\//);
  });
});

describe("external protocol policy", () => {
  it("only lets https reach the operating system", () => {
    expect(isAllowedExternalProtocol("https:")).toBe(true);
    for (const protocol of ["http:", "mailto:", "file:", "javascript:", "data:", "vscode:", "smb:", "ssh:"]) {
      expect(isAllowedExternalProtocol(protocol)).toBe(false);
    }
  });
});

describe("navigation policy", () => {
  it("allows the app's own document", () => {
    expect(isAllowedNavigationUrl(`${PACKAGED_ROOT}/index.html`, packaged)).toBe(true);
    expect(isAllowedNavigationUrl(PACKAGED_ROOT, packaged)).toBe(true);
  });

  it("rejects a sibling directory that merely shares the prefix", () => {
    expect(isAllowedNavigationUrl(`${PACKAGED_ROOT}-old/index.html`, packaged)).toBe(false);
  });

  it("rejects remote origins in a packaged build", () => {
    expect(isAllowedNavigationUrl("https://example.com/", packaged)).toBe(false);
    expect(isAllowedNavigationUrl("file:///etc/passwd", packaged)).toBe(false);
  });

  it("allows the dev server origin only when one is configured", () => {
    const development = { ...packaged, devServerUrl: "http://localhost:5173" };
    expect(isAllowedNavigationUrl("http://localhost:5173/index.html", development)).toBe(true);
    expect(isAllowedNavigationUrl("http://localhost:5173.evil.example/", development)).toBe(false);
    expect(isAllowedNavigationUrl("http://localhost:5173/index.html", packaged)).toBe(false);
  });

  it("fails closed when the dev server url cannot be parsed", () => {
    const broken = { ...packaged, devServerUrl: "not a url" };
    expect(isAllowedNavigationUrl("https://example.com/", broken)).toBe(false);
    expect(isAllowedNavigationUrl(`${PACKAGED_ROOT}/index.html`, broken)).toBe(true);
  });
});

describe("log redaction of urls", () => {
  it("drops credentials and query strings", () => {
    expect(redactUrlForLog("https://user:hunter2@example.com/callback?token=abc#frag")).toBe("https://example.com/callback");
    expect(redactUrlForLog("nonsense")).toBe("[unparseable url]");
  });
});

describe("keychain policy", () => {
  it("never disables the keychain that protects provider credentials", () => {
    // See docs/architecture/credential-storage-keychain-policy.md. Matching the
    // call rather than the bare name keeps this guard from firing on comments
    // that explain why the switch must not be used.
    const mainDirectory = fileURLToPath(new URL("../main", import.meta.url));
    const forbidden = [/appendSwitch\(\s*["']use-mock-keychain["']/, /setUsePlainTextEncryption\s*\(/];
    const sources = readdirSync(mainDirectory).filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"));
    expect(sources.length).toBeGreaterThan(0);

    for (const entry of sources) {
      const contents = readFileSync(path.join(mainDirectory, entry), "utf8");
      for (const pattern of forbidden) expect(contents, `${entry} must not match ${String(pattern)}`).not.toMatch(pattern);
    }
  });
});
