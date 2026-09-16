import { app } from "electron";
import electronUpdater, { type UpdateDownloadedEvent, type UpdateInfo } from "electron-updater";
import { log } from "./logger.js";
import { describeUpdateTarget, resolveUpdateChannel, shouldCheckForUpdates, type UpdateChannel } from "../shared/update-policy.js";

const { autoUpdater } = electronUpdater;

/**
 * Automatic updates.
 *
 * Releases publish an electron-updater feed — `latest-mac.yml`, `latest.yml`,
 * `latest-linux.yml` — alongside the artifacts, so the updater reads the channel
 * manifest for the running platform from the newest published GitHub release. On
 * macOS it hands the archive to Squirrel.Mac, which is what enforces that an
 * update carries the same code signature as the running app; nothing here has to
 * verify that itself.
 *
 * The feed describes a version's artifacts, so an installed app finds the *next*
 * release, never its own. That also means a build packaged before the publisher
 * config existed has no `app-update.yml` and cannot update itself at all: those
 * installs need one manual download.
 */

export interface AutoUpdateHandle {
  check(): Promise<void>;
  dispose(): void;
}

const noop: AutoUpdateHandle = { check: async () => {}, dispose: () => {} };

/** Long enough not to compete with start-up, short enough to notice on a normal session. */
const STARTUP_DELAY_MS = 20_000;

export function startAutoUpdater(channel: UpdateChannel = resolveUpdateChannel(process.env.APPLE_PI_UPDATE_CHANNEL)): AutoUpdateHandle {
  const enabled = shouldCheckForUpdates({
    isPackaged: app.isPackaged,
    forceDev: process.env.APPLE_PI_FORCE_UPDATES === "1",
    disabled: process.env.APPLE_PI_DISABLE_UPDATES === "1",
  });

  if (!enabled) {
    log.info("automatic updates are off", { packaged: app.isPackaged });
    return noop;
  }

  autoUpdater.channel = channel;
  // Assigning a channel turns downgrades on, and a published version must never be
  // replaced by an older one, so this is set afterwards rather than before.
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoDownload = true;
  // electron-updater 7 / electron-builder 27 replaces this with `autoInstallEvent`;
  // a one-line swap when this repository moves to that line.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message?: unknown) => log.info("updater", { message }),
    warn: (message?: unknown) => log.warn("updater", { message }),
    error: (message?: unknown) => log.error("updater", { message }),
    debug: (message?: unknown) => log.debug("updater", { message }),
  };

  const disposers: Array<() => void> = [];

  const onCheckingForUpdate = (): void => log.info("checking for an update", { channel, target: describeUpdateTarget(channel) });
  const onUpdateNotAvailable = (): void => log.info("no update available", { channel });
  const onUpdateAvailable = (info: UpdateInfo): void => log.info("update available; downloading in the background", { version: info.version });
  const onUpdateDownloaded = (info: UpdateDownloadedEvent): void =>
    log.info("update downloaded; it will install when Apple Pi quits", { version: info.version });
  const onError = (error: Error): void => log.warn("update check failed", { message: error?.message ?? String(error) });

  // No prompt: the renderer has no update UI, and installing on quit means a user
  // is never interrupted mid-session. Registered individually rather than from a
  // table so each handler keeps its event's argument type.
  autoUpdater.on("checking-for-update", onCheckingForUpdate);
  autoUpdater.on("update-not-available", onUpdateNotAvailable);
  autoUpdater.on("update-available", onUpdateAvailable);
  autoUpdater.on("update-downloaded", onUpdateDownloaded);
  autoUpdater.on("error", onError);
  disposers.push(
    () => autoUpdater.off("checking-for-update", onCheckingForUpdate),
    () => autoUpdater.off("update-not-available", onUpdateNotAvailable),
    () => autoUpdater.off("update-available", onUpdateAvailable),
    () => autoUpdater.off("update-downloaded", onUpdateDownloaded),
    () => autoUpdater.off("error", onError),
  );

  const check = async (): Promise<void> => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      // Offline machines and unpublished feeds are both ordinary here.
      log.warn("update check threw", { error });
    }
  };

  const timer = setTimeout(() => void check(), STARTUP_DELAY_MS);

  return {
    check,
    dispose: () => {
      clearTimeout(timer);
      for (const dispose of disposers) dispose();
    },
  };
}
