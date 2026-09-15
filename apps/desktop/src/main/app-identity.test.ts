import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest: { name?: string; productName?: string; build?: { appId?: string; productName?: string } } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

describe("application identity", () => {
  it("declares the product name Electron resolves as the application name", () => {
    // Electron's `app.getName()` prefers a package.json `productName` and falls
    // back to `name`. That name is not cosmetic: it determines the OS keychain
    // item that protects provider credentials ("<name> Safe Storage") and the
    // `userData` directory. Falling back to `name` would name both after the npm
    // package, which is how 0.3.0 shipped a prompt deliberately asking for
    // "@apple-pi/desktop Safe Storage".
    // See docs/architecture/credential-storage-keychain-policy.md.
    expect(manifest.productName).toBe("Apple Pi");
    expect(manifest.name).not.toBe(manifest.productName);
  });

  it("declares the product name only once", () => {
    // `build.productName` reaches the app bundle but not the runtime
    // package.json, so keeping both would let the bundle and the application
    // name drift apart silently.
    expect(manifest.build?.productName).toBeUndefined();
    expect(manifest.build?.appId).toBe("verysmallwoods.applepi");
  });
});
