import assert from "node:assert/strict";
import test from "node:test";

import { adHocSignInvocation } from "./resign-macos-adhoc.mjs";

const context = {
  electronPlatformName: "darwin",
  appOutDir: "/tmp/apple-pi/mac-arm64",
  packager: { appInfo: { productFilename: "Apple Pi" } },
};

test("deeply re-signs the unsigned local macOS app after Electron Builder signs it", () => {
  assert.deepEqual(adHocSignInvocation(context, { APPLE_PI_ADHOC_RESIGN: "1" }), {
    command: "codesign",
    args: ["--force", "--deep", "--sign", "-", "/tmp/apple-pi/mac-arm64/Apple Pi.app"],
  });
});

test("does not replace release signatures or run on other platforms", () => {
  assert.equal(adHocSignInvocation(context, {}), null);
  assert.equal(adHocSignInvocation({ ...context, electronPlatformName: "win32" }, { APPLE_PI_ADHOC_RESIGN: "1" }), null);
});

test("fails clearly when the enabled hook cannot identify the app", () => {
  assert.throws(() => adHocSignInvocation({ ...context, packager: {} }, { APPLE_PI_ADHOC_RESIGN: "1" }), /did not provide the product filename/);
});
