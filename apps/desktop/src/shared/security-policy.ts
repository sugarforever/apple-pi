/**
 * Security policy shared by the Electron main process and its tests.
 *
 * Deliberately free of Electron imports: this module is pure data and pure
 * functions so that every rule below can be unit tested in a plain Node
 * process, where the hardened behaviour it describes cannot be verified.
 */

export const APP_ID = "verysmallwoods.applepi";

/**
 * Must stay byte-identical to the `Content-Security-Policy` meta tag in
 * `src/renderer/index.html`. That tag is the enforcement point for packaged
 * builds: the renderer is loaded over `file:`, which has no response headers to
 * carry a policy. `security-policy.test.ts` asserts the two match, so a change
 * here that is not mirrored there fails CI instead of silently shipping.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  // `frame-ancestors` is deliberately absent: browsers ignore it in a meta tag
  // and log a console warning on every launch. The app cannot be framed anyway
  // -- there is no <iframe> and `webviewTag` is disabled.
].join("; ");

/**
 * Schemes allowed to reach the user's browser. `https:` only: never hand
 * `file:`, `javascript:`, `mailto:`, or an arbitrary custom scheme to the OS.
 *
 * This preserves the policy the main process already enforced before this
 * module existed; adding a scheme here is a product decision.
 */
const EXTERNAL_PROTOCOLS: readonly string[] = ["https:"];

export function isAllowedExternalProtocol(protocol: string): boolean {
  return EXTERNAL_PROTOCOLS.includes(protocol.toLowerCase());
}

export interface NavigationPolicy {
  /** Vite dev server origin, when running `electron-vite dev`. */
  readonly devServerUrl?: string | undefined;
  /** `file:` URL of the directory the packaged renderer is served from. */
  readonly rendererRootHref: string;
}

/**
 * True when the renderer may navigate to `url` in place. Everything else is an
 * attempt to leave the app and must open in the user's browser instead.
 */
export function isAllowedNavigationUrl(url: string, policy: NavigationPolicy): boolean {
  if (policy.devServerUrl) {
    try {
      if (new URL(url).origin === new URL(policy.devServerUrl).origin) return true;
    } catch {
      // Unparseable dev URL: fall through to the file check.
    }
  }
  const root = policy.rendererRootHref.endsWith("/") ? policy.rendererRootHref : `${policy.rendererRootHref}/`;
  // The trailing slash matters: `.../renderer/` must not match `.../renderer-old/`.
  return url === policy.rendererRootHref || url.startsWith(root);
}

/** Strips query strings and credentials before a URL is written to a log. */
export function redactUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "[unparseable url]";
  }
}
