import { describe, expect, it } from "vitest";
import type { SlashCommand } from "../pi/types.js";
import { buildPrompt, filterCommands, slashQuery } from "./prompt.js";

const image = { type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" };

describe("buildPrompt", () => {
  it("starts a run while idle, carrying images as Pi ImageContent", () => {
    expect(buildPrompt("What is this?", [image], { running: false })).toEqual({ type: "prompt", message: "What is this?", images: [image] });
    expect(buildPrompt("Hi", [], { running: false })).toEqual({ type: "prompt", message: "Hi" });
  });

  it("queues as a steer while running, or as a follow-up when asked", () => {
    expect(buildPrompt("Use pnpm", [], { running: true })).toEqual({ type: "prompt", message: "Use pnpm", streamingBehavior: "steer" });
    expect(buildPrompt("Then summarise", [], { running: true, followUp: true })).toEqual({
      type: "prompt",
      message: "Then summarise",
      streamingBehavior: "followUp",
    });
  });
});

describe("command palette filtering", () => {
  const command = (name: string, source: SlashCommand["source"]): SlashCommand => ({
    name,
    source,
    sourceInfo: { path: `/demo/${name}`, source: "local", scope: "user", origin: "top-level" },
  });
  const commands = [command("review", "extension"), command("fix-tests", "prompt"), command("skill:test-runner", "skill"), command("prefix-test", "prompt")];

  it("opens only while the draft is a bare command name", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/fix")).toBe("fix");
    expect(slashQuery("/fix-tests now")).toBeUndefined();
    expect(slashQuery("fix /tests")).toBeUndefined();
  });

  it("ranks name prefixes, then bare skill names, then substrings", () => {
    expect(filterCommands(commands, "").map((item) => item.name)).toEqual(["review", "fix-tests", "skill:test-runner", "prefix-test"]);
    expect(filterCommands(commands, "TEST").map((item) => item.name)).toEqual(["skill:test-runner", "fix-tests", "prefix-test"]);
    expect(filterCommands(commands, "zzz")).toEqual([]);
  });
});
