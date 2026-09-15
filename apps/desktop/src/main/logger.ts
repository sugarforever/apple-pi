import { closeSync, mkdirSync, openSync, renameSync, statSync, writeSync } from "node:fs";
import path from "node:path";

/**
 * Structured, redacting logger for the Electron main process.
 *
 * Two rules drive this module:
 *
 * 1. Never write a credential to disk or to the console. Everything passes
 *    through {@link redact} before it is serialized, and object keys that look
 *    like secrets are replaced outright.
 * 2. Never let logging break the app. A failing sink is dropped, not thrown.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Patterns for credentials that must never reach a log sink. */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{16,}/g, "sk-***"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, "ghp_***"],
  [/\b(xox[baprs]-)[A-Za-z0-9-]{10,}/g, "$1***"],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1***"],
  [/\b(api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)(["']?\s*[:=]\s*["']?)([^\s"',;}]+)/gi, "$1$2***"],
  [/:\/\/[^:@/\s]+:[^@/\s]+@/g, "://***:***@"],
];

/** Object keys whose values are replaced with `***` regardless of content. */
const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|authorization|credential/i;

const MAX_LOG_BYTES = 5 * 1024 * 1024;

export function redact(value: string): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function toSerializable(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redact(value);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: redact(value.message), stack: value.stack ? redact(value.stack) : undefined };
  if (value instanceof URL) return value.href;
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => toSerializable(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = SECRET_KEY.test(key) ? "***" : toSerializable(item, depth + 1);
  return result;
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  child(scope: string): Logger;
}

let minimumLevel: LogLevel = process.env.APPLEPI_LOG_LEVEL === "debug" ? "debug" : "info";
let sink: ((line: string) => void) | undefined;

/** Redirects log output. Used by tests and by the packaged app's file sink. */
export function setLogSink(next: ((line: string) => void) | undefined): void {
  sink = next;
}

export function setLogLevel(level: LogLevel): void {
  minimumLevel = level;
}

function emit(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minimumLevel]) return;
  const record = {
    time: new Date().toISOString(),
    level,
    scope,
    message: redact(message),
    ...(meta === undefined ? {} : { meta: toSerializable(meta) }),
  };
  let line: string;
  try {
    line = `${JSON.stringify(record)}\n`;
  } catch {
    line = `${JSON.stringify({ time: record.time, level, scope, message: "[unserializable log record]" })}\n`;
  }
  try {
    process.stderr.write(line);
  } catch {
    // A closed stderr must never take the app down.
  }
  try {
    sink?.(line);
  } catch {
    // Drop the sink on failure rather than failing every later write.
    sink = undefined;
  }
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, meta) => emit("debug", scope, message, meta),
    info: (message, meta) => emit("info", scope, message, meta),
    warn: (message, meta) => emit("warn", scope, message, meta),
    error: (message, meta) => emit("error", scope, message, meta),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}

export const log = createLogger("main");

/**
 * Attaches a size-rotating file sink under the OS log directory. Rotation is
 * best effort: the previous file is moved to `<name>.1` and replaced.
 *
 * @returns the absolute path of the active log file.
 */
export function attachFileLogging(logDirectory: string, fileName = "main.log"): string {
  mkdirSync(logDirectory, { recursive: true });
  const filePath = path.join(logDirectory, fileName);
  try {
    if (statSync(filePath).size > MAX_LOG_BYTES) renameSync(filePath, `${filePath}.1`);
  } catch {
    // Missing or unreadable log file: start a fresh one.
  }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, "a");
  } catch {
    return filePath;
  }
  let written = 0;
  const write = (line: string): void => {
    if (descriptor === undefined) return;
    try {
      written += writeSync(descriptor, line);
      if (written > MAX_LOG_BYTES) {
        closeSync(descriptor);
        descriptor = undefined;
      }
    } catch {
      // Ignore sink failures; console output still works.
    }
  };
  setLogSink(write);
  return filePath;
}
