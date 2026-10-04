import { describe, expect, it } from "vitest";
import { chatTitle, matchesQuery } from "./chats.js";

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
