import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attachFileLogging, createLogger, redact, setLogLevel, setLogSink } from "./logger.js";

const originalStderrWrite = process.stderr.write.bind(process.stderr);

/** Keeps assertions readable: the logger mirrors every record to stderr. */
function silenceStderr(): () => void {
  process.stderr.write = (() => true) as typeof process.stderr.write;
  return () => {
    process.stderr.write = originalStderrWrite;
  };
}

afterEach(() => {
  setLogSink(undefined);
  setLogLevel("info");
});

describe("redact", () => {
  it("removes common credential shapes", () => {
    expect(redact("key sk-abcdefghijklmnopqrstuvwx")).toBe("key sk-***");
    expect(redact("Authorization: Bearer abcdefghijklmnop")).not.toContain("abcdefghijklmnop");
    expect(redact('{"api_key": "hunter2hunter2"}')).not.toContain("hunter2hunter2");
    expect(redact("https://user:secretpw@example.com/x")).toBe("https://***:***@example.com/x");
  });

  it("leaves ordinary text untouched", () => {
    expect(redact("opened workspace /Users/dev/project")).toBe("opened workspace /Users/dev/project");
  });
});

describe("structured records", () => {
  it("redacts secret-shaped keys at any depth", () => {
    const lines: string[] = [];
    const restore = silenceStderr();
    setLogSink((line) => lines.push(line));
    setLogLevel("debug");
    createLogger("test").info("payload", { nested: { apiKey: "abc123", token: "xyz", workspace: "visible" } });
    restore();

    const record = JSON.parse(lines[0]!);
    expect(record.level).toBe("info");
    expect(record.scope).toBe("test");
    expect(record.meta.nested).toEqual({ apiKey: "***", token: "***", workspace: "visible" });
  });

  it("keeps the field name when it is not secret-shaped", () => {
    const lines: string[] = [];
    const restore = silenceStderr();
    setLogSink((line) => lines.push(line));
    createLogger("test").warn("renderer failed to load", { errorCode: -6, errorDescription: "ERR_FILE_NOT_FOUND" });
    restore();

    expect(JSON.parse(lines[0]!).meta).toEqual({ errorCode: -6, errorDescription: "ERR_FILE_NOT_FOUND" });
  });

  it("survives circular metadata and thrown sinks", () => {
    const lines: string[] = [];
    const restore = silenceStderr();
    setLogSink((line) => {
      lines.push(line);
      throw new Error("sink is broken");
    });
    const circular: Record<string, unknown> = { workspace: "project" };
    circular.self = circular;

    expect(() => createLogger("test").error("cycle", { circular })).not.toThrow();
    // A failing sink is dropped, not retried, so the next record still reaches stderr.
    expect(() => createLogger("test").error("second")).not.toThrow();
    expect(lines).toHaveLength(1);
    restore();
  });
});

describe("file logging", () => {
  it("appends one JSON record per line", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "apple-pi-logs-"));
    const restore = silenceStderr();
    try {
      const filePath = attachFileLogging(directory);
      createLogger("test").info("hello", { workspace: "project" });
      const contents = readFileSync(filePath, "utf8").trimEnd().split("\n");
      expect(contents).toHaveLength(1);
      expect(JSON.parse(contents[0]!)).toMatchObject({ level: "info", scope: "test", message: "hello" });
    } finally {
      restore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rotates a log file that exceeds the size limit", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "apple-pi-logs-"));
    const restore = silenceStderr();
    try {
      const filePath = attachFileLogging(directory);
      writeFileSync(filePath, "x".repeat(6 * 1024 * 1024));
      attachFileLogging(directory);
      expect(readFileSync(`${filePath}.1`, "utf8")).toHaveLength(6 * 1024 * 1024);
    } finally {
      restore();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
