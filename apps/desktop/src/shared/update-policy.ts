/**
 * When and how Apple Pi looks for updates.
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

export type UpdateChannel = "latest" | "beta";

/**
 * Only two channels exist, and an unknown value falls back to stable rather than
 * to something the release workflow never publishes a manifest for.
 */
export function resolveUpdateChannel(value: string | undefined): UpdateChannel {
  return value?.trim().toLowerCase() === "beta" ? "beta" : "latest";
}

/** What `app-update.yml` resolves to, for logging when an update check fails. */
export function describeUpdateTarget(channel: UpdateChannel): string {
  return channel === "beta" ? "the beta channel" : "the stable channel";
}
