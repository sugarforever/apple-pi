import { execFile } from "node:child_process";
import { createLogger } from "./logger.js";

const log = createLogger("shell-env");

const MARK = "_APPLE_PI_SHELL_ENV_";
const TIMEOUT_MS = 5_000;
/** Set only to run the probe itself; Pi gets its own `ELECTRON_RUN_AS_NODE` at spawn. */
const PROBE_KEYS = ["ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE"];

/** Reads the JSON environment printed between two marks, ignoring whatever the profile printed around it. */
export function parseShellEnv(output: string): Record<string, string> {
  const start = output.indexOf(MARK);
  const end = output.lastIndexOf(MARK);
  if (start === -1 || end <= start) return {};
  const env = JSON.parse(output.slice(start + MARK.length, end)) as Record<string, string>;
  for (const key of PROBE_KEYS) delete env[key];
  return env;
}

let loaded: Promise<NodeJS.ProcessEnv> | undefined;

/**
 * The environment Pi runs with. An app opened from Finder, the Dock, or a Linux
 * launcher does not inherit the login shell's environment, so API keys exported
 * in `~/.zshrc` and friends would be invisible to Pi. Like VS Code, ask the
 * user's shell once and print the result with Electron's own Node. Any failure
 * falls back to `process.env`.
 */
export function shellEnv(): Promise<NodeJS.ProcessEnv> {
  loaded ??= process.platform === "win32" ? Promise.resolve(process.env) : probe();
  return loaded;
}

function probe(): Promise<NodeJS.ProcessEnv> {
  const shell = process.env.SHELL || "/bin/sh";
  const node = `'${process.execPath.replaceAll("'", `'\\''`)}'`;
  const command = `${node} -p '"${MARK}" + JSON.stringify(process.env) + "${MARK}"'`;
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", ELECTRON_NO_ATTACH_CONSOLE: "1" };
  return new Promise((resolve) => {
    execFile(shell, ["-ilc", command], { env, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
      try {
        if (error) throw error;
        const resolved = parseShellEnv(stdout);
        if (Object.keys(resolved).length === 0) throw new Error("shell printed no environment");
        resolve({ ...process.env, ...resolved });
      } catch (failure) {
        log.warn("using the app environment; reading the login shell environment failed", { shell, error: failure });
        resolve(process.env);
      }
    });
  });
}
