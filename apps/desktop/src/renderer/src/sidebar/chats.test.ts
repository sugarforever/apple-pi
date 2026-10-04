import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { adjacentChat, chatTitle, matchesQuery } from "./chats.js";

describe("chatTitle", () => {
  it("prefers the extension title, then Pi's session name, then the first message", () => {
    expect(chatTitle({ extensionTitle: "pi · deploying", sessionName: "Deploy", firstMessage: "ship it" })).toBe("pi · deploying");
    expect(chatTitle({ extensionTitle: "  ", sessionName: "Deploy", firstMessage: "ship it" })).toBe("Deploy");
    expect(chatTitle({ firstMessage: "Fix the\n\n  flaky   test" })).toBe("Fix the flaky test");
    expect(chatTitle({})).toBe("New chat");
  });
});

describe("matchesQuery", () => {
  it("matches every word in any order, ignoring case", () => {
    expect(matchesQuery("Plan the RPC rebuild", "rpc plan")).toBe(true);
    expect(matchesQuery("Plan the RPC rebuild", "rpc deploy")).toBe(false);
  });
});

describe("adjacentChat", () => {
  const session = (path: string) => ({ path }) as SessionInfo;
  const projects = [
    { workspace: "/a", chats: [session("a1"), session("a2")] },
    { workspace: "/b", chats: undefined },
    { workspace: "/c", chats: [session("c1")] },
  ];

  it("steps through the sidebar order across projects, wrapping at the ends", () => {
    expect(adjacentChat(projects, "a2", 1)).toEqual({ workspace: "/c", sessionFile: "c1" });
    expect(adjacentChat(projects, "c1", 1)).toEqual({ workspace: "/a", sessionFile: "a1" });
    expect(adjacentChat(projects, "a1", -1)).toEqual({ workspace: "/c", sessionFile: "c1" });
  });

  it("starts from either end without a current chat", () => {
    expect(adjacentChat(projects, undefined, 1)?.sessionFile).toBe("a1");
    expect(adjacentChat(projects, undefined, -1)?.sessionFile).toBe("c1");
    expect(adjacentChat([], undefined, 1)).toBeUndefined();
  });
});
