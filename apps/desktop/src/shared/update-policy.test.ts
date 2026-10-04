import { describe, expect, it } from "vitest";
import { describeUpdateTarget, resolveUpdateChannel, shouldCheckForUpdates } from "./update-policy.js";

describe("update eligibility", () => {
  it("runs in a packaged build", () => {
    expect(shouldCheckForUpdates({ isPackaged: true })).toBe(true);
  });

  it("never runs in development, where it would replace the working copy", () => {
    expect(shouldCheckForUpdates({ isPackaged: false })).toBe(false);
    expect(shouldCheckForUpdates({ isPackaged: false, forceDev: false })).toBe(false);
  });

  it("can be forced, so the feed can be exercised from a dev build", () => {
    expect(shouldCheckForUpdates({ isPackaged: false, forceDev: true })).toBe(true);
  });

  it("honours an explicit opt-out even when packaged", () => {
    expect(shouldCheckForUpdates({ isPackaged: true, disabled: true })).toBe(false);
    expect(shouldCheckForUpdates({ isPackaged: true, forceDev: true, disabled: true })).toBe(false);
  });
});

describe("update channel", () => {
  it("defaults to stable", () => {
    expect(resolveUpdateChannel(undefined)).toBe("lite");
    expect(resolveUpdateChannel("")).toBe("lite");
    expect(resolveUpdateChannel("   ")).toBe("lite");
  });

  it("accepts beta however it is written", () => {
    expect(resolveUpdateChannel("beta")).toBe("lite-beta");
    expect(resolveUpdateChannel(" Beta ")).toBe("lite-beta");
  });

  it("falls back to stable rather than to a channel with no manifest", () => {
    // The release workflow only ever publishes the lite manifests, so an
    // unknown value must not become a channel the updater cannot fetch.
    expect(resolveUpdateChannel("nightly")).toBe("lite");
    expect(resolveUpdateChannel("lite")).toBe("lite");
  });

  it("never follows the earlier Apple Pi's latest feed", () => {
    // Apple Pi 0.6 and earlier read latest*.yml from the same releases.
    expect(resolveUpdateChannel("latest")).toBe("lite");
  });

  it("describes the channel for a log line", () => {
    expect(describeUpdateTarget("lite")).toBe("the stable channel");
    expect(describeUpdateTarget("lite-beta")).toBe("the beta channel");
  });
});
