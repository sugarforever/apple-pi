import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_ID } from "../shared/security-policy.js";
import { resolveUpdateChannel } from "../shared/update-policy.js";

const manifest: {
  name?: string;
  productName?: string;
  build?: { appId?: string; productName?: string; publish?: Array<{ channel?: string }>; extraMetadata?: { name?: string } };
} = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

describe("application identity", () => {
  it("declares the product name Electron resolves as the application name", () => {
    // Electron's `app.getName()` prefers a package.json `productName` and falls
    // back to `name`. That name is not cosmetic: it determines the `userData`
    // and logs directories, where the workspace catalog lives. Falling back to
    // `name` would name it after the npm package, as 0.3.0 once did.
    expect(manifest.productName).toBe("Apple Pi Lite");
    expect(manifest.name).not.toBe(manifest.productName);
  });

  it("declares the product name only once", () => {
    // `build.productName` reaches the app bundle but not the runtime
    // package.json, so keeping both would let the bundle and the application
    // name drift apart silently.
    expect(manifest.build?.productName).toBeUndefined();
  });

  it("is a separate application from the earlier Apple Pi", () => {
    // Apple Pi 0.6 and earlier used `verysmallwoods.applepi`. A distinct bundle
    // identifier keeps the two installable side by side.
    expect(manifest.build?.appId).toBe("ai.applepi.lite");
    expect(APP_ID).toBe(manifest.build?.appId);
    // The packaged name names the updater cache directory; the workspace package
    // name would collide with the earlier app's.
    expect(manifest.build?.extraMetadata?.name).toBe("apple-pi-lite");
  });

  it("publishes the update feed on the channel the app reads", () => {
    expect(manifest.build?.publish?.map((entry) => entry.channel)).toEqual([resolveUpdateChannel(undefined)]);
  });
});
