import { expect, it } from "vitest";
import { chatIndicator, initialActivity, reduceActivity, type ActivityAction } from "./activity.js";

const run = (...actions: ActivityAction[]) => actions.reduce(reduceActivity, initialActivity);

it("shows a running chat by its file, whether keyed by file or by a new session's key", () => {
  const state = run(
    { type: "attached", sessionKey: "uuid-1", sessionFile: "/s/new.jsonl" },
    { type: "started", sessionKey: "uuid-1" },
    { type: "started", sessionKey: "/s/old.jsonl" },
  );
  expect(chatIndicator(state, "/s/new.jsonl")).toBe("running");
  expect(chatIndicator(state, "/s/old.jsonl")).toBe("running");
  expect(chatIndicator(state, "/s/other.jsonl")).toBeUndefined();
});

it("marks a run that finished out of sight as unread until the chat is viewed", () => {
  const background = run(
    { type: "viewing", sessionFile: "/s/a.jsonl" },
    { type: "started", sessionKey: "/s/b.jsonl" },
    { type: "settled", sessionKey: "/s/b.jsonl" },
  );
  expect(chatIndicator(background, "/s/b.jsonl")).toBe("unread");
  expect(chatIndicator(reduceActivity(background, { type: "viewing", sessionFile: "/s/b.jsonl" }), "/s/b.jsonl")).toBeUndefined();

  const onScreen = run(
    { type: "viewing", sessionFile: "/s/a.jsonl" },
    { type: "started", sessionKey: "/s/a.jsonl" },
    { type: "settled", sessionKey: "/s/a.jsonl" },
  );
  expect(chatIndicator(onScreen, "/s/a.jsonl")).toBeUndefined();
});

it("does not mark an idle process that exits as unread", () => {
  expect(chatIndicator(run({ type: "settled", sessionKey: "/s/a.jsonl" }), "/s/a.jsonl")).toBeUndefined();
});
