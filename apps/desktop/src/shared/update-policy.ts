/**
 * When and how Apple Pi Lite looks for updates.
 *
 * Kept free of Electron imports so the decisions can be tested in a plain Node
 * process, where the behaviour they gate cannot be exercised.
 */

export interface UpdateEnvironment {
  /** `app.isPackaged`: a development build must never replace itself with a published release. */
  readonly isPackaged: boolean;
  /** Escape hatch for testing the updater against a real feed from a dev build. */
  readonly forceDev?: boolean;
  /** Set by a user or a support session to stop the app updating itself. */
  readonly disabled?: boolean;
}

export function shouldCheckForUpdates({ isPackaged, forceDev = false, disabled = false }: UpdateEnvironment): boolean {
  if (disabled) return false;
  return isPackaged || forceDev;
}

/**
 * Apple Pi Lite publishes its update feed under its own channel names
 * (`lite-mac.yml`, `lite.yml`, `lite-linux.yml`; see `build.publish` in
 * package.json), never the default `latest*.yml`. The earlier Apple Pi (0.6 and
 * before) shares this repository's releases and reads `latest*.yml`, so the two
 * apps never see each other's builds as updates.
 */
export type UpdateChannel = "lite" | "lite-beta";

/**
 * Only two channels exist, and an unknown value falls back to stable rather than
 * to something the release workflow never publishes a manifest for.
 */
export function resolveUpdateChannel(value: string | undefined): UpdateChannel {
  return value?.trim().toLowerCase() === "beta" ? "lite-beta" : "lite";
}

/** What `app-update.yml` resolves to, for logging when an update check fails. */
export function describeUpdateTarget(channel: UpdateChannel): string {
  return channel === "lite-beta" ? "the beta channel" : "the stable channel";
}
