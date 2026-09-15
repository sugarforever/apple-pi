import { app, shell, type BrowserWindow, type Session, type WebContents } from "electron";
import { pathToFileURL } from "node:url";
import { log } from "./logger.js";
import { APP_ID, isAllowedExternalProtocol, isAllowedNavigationUrl, redactUrlForLog, type NavigationPolicy } from "../shared/security-policy.js";

/**
 * Electron security policy for a local-first desktop app.
 *
 * The renderer is untrusted: it may only render, and may only reach the outside
 * world through the preload capability bridge. Every rule that crosses the
 * process boundary is enforced here rather than in renderer code.
 *
 * The pure decision logic lives in `../shared/security-policy.ts` so it can be
 * unit tested; this module only wires it to Electron.
 */

export function openExternalUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    log.warn("refused to open malformed external url");
    return;
  }
  if (!isAllowedExternalProtocol(url.protocol)) {
    log.warn("refused to open external url with disallowed protocol", { protocol: url.protocol });
    return;
  }
  log.info("opening external url", { host: url.host, protocol: url.protocol, path: redactUrlForLog(url.href) });
  void shell.openExternal(url.href).catch((error: unknown) => log.error("failed to open external url", { error }));
}

/** Process-wide hardening. Must run before `app.whenReady()` resolves. */
export function applyProcessHardening(): void {
  // Guarantees the sandbox for every renderer, including any created by future
  // code paths that forget to set `sandbox: true`.
  app.enableSandbox();
  app.setAppUserModelId(APP_ID);

  app.on("web-contents-created", (_event, contents: WebContents) => {
    // <webview> would bypass the preload contract; this app never uses it.
    contents.on("will-attach-webview", (event) => {
      log.warn("blocked webview attachment");
      event.preventDefault();
    });
    // Deny by default; `applyWindowPolicy` installs the real handler.
    contents.setWindowOpenHandler(({ url }) => {
      openExternalUrl(url);
      return { action: "deny" };
    });
  });
}

export interface WindowPolicyOptions {
  readonly devServerUrl?: string | undefined;
  /** Directory the packaged renderer is served from. */
  readonly rendererRoot: string;
}

/**
 * Per-window policy: navigation stays inside the app, links leave through the
 * browser, and renderer failures become observable instead of silent.
 */
export function applyWindowPolicy(window: BrowserWindow, options: WindowPolicyOptions): void {
  const contents = window.webContents;
  const policy: NavigationPolicy = { devServerUrl: options.devServerUrl, rendererRootHref: pathToFileURL(options.rendererRoot).href };

  contents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  const guard = (event: { preventDefault(): void }, url: string): void => {
    if (isAllowedNavigationUrl(url, policy)) return;
    event.preventDefault();
    log.warn("blocked in-app navigation", { url: redactUrlForLog(url) });
    openExternalUrl(url);
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);

  contents.on("render-process-gone", (_event, details) => log.error("renderer process gone", { reason: details.reason, exitCode: details.exitCode }));
  contents.on("unresponsive", () => log.warn("renderer became unresponsive"));
  contents.on("preload-error", (_event, preloadPath, error) => log.error("preload script failed", { preloadPath, error }));
}

/**
 * Session policy. The renderer needs no device, media, geolocation, clipboard,
 * or notification privilege, so every request is denied rather than prompted.
 */
export function applySessionPolicy(session: Session): void {
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    log.warn("denied permission request", { permission });
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.setSpellCheckerEnabled(false);
}
