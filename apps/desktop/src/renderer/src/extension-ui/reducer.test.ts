import { describe, expect, it } from "vitest";
import type { RpcExtensionUIRequest } from "@earendil-works/pi-coding-agent";
import {
  cancelResponse,
  confirmResponse,
  initialExtensionUI,
  reduceExtensionUI,
  stripAnsi,
  unhandledResponse,
  valueResponse,
  type ExtensionUIAction,
  type ExtensionUIState,
} from "./reducer.js";

const request = (fields: Record<string, unknown>) => ({ type: "extension_ui_request", ...fields }) as RpcExtensionUIRequest;
const receive = (state: ExtensionUIState, fields: Record<string, unknown>, at = 1_000): ExtensionUIState =>
  reduceExtensionUI(state, { type: "request", request: request(fields), sessionKey: "s1", at });
const run = (...actions: ExtensionUIAction[]) => actions.reduce(reduceExtensionUI, initialExtensionUI);

describe("extension dialogs", () => {
  it("queues dialogs in arrival order and shows the next once one is resolved", () => {
    let state = receive(initialExtensionUI, { id: "a", method: "confirm", title: "Clear session?", message: "All messages will be lost.", timeout: 5_000 });
    state = receive(state, { id: "b", method: "select", title: "Pick", options: ["Allow", "Block"] });
    expect(state.dialogs.map((dialog) => dialog.request.id)).toEqual(["a", "b"]);
    expect(state.dialogs[0]).toMatchObject({ sessionKey: "s1", deadline: 6_000 });
    expect(state.dialogs[1]!.deadline).toBeUndefined();

    state = reduceExtensionUI(state, { type: "resolved", id: "a" });
    expect(state.dialogs.map((dialog) => dialog.request.id)).toEqual(["b"]);
  });

  it("builds the documented response payloads; timeout and Escape both cancel", () => {
    expect(valueResponse("b", "Allow")).toEqual({ type: "extension_ui_response", id: "b", value: "Allow" });
    expect(confirmResponse("a", false)).toEqual({ type: "extension_ui_response", id: "a", confirmed: false });
    expect(cancelResponse("a")).toEqual({ type: "extension_ui_response", id: "a", cancelled: true });
  });

  it("drops only the exited process's dialogs", () => {
    let state = receive(initialExtensionUI, { id: "a", method: "input", title: "Name" });
    state = reduceExtensionUI(state, { type: "request", request: request({ id: "b", method: "editor", title: "Edit" }), sessionKey: "s2", at: 0 });
    state = reduceExtensionUI(state, { type: "exited", sessionKey: "s1" });
    expect(state.dialogs.map((dialog) => dialog.request.id)).toEqual(["b"]);
  });
});

describe("unknown methods", () => {
  it("are cancelled right away so Pi never waits, and leave the state alone", () => {
    const future = request({ id: "x", method: "pickColor", title: "Colour?" });
    expect(unhandledResponse(future)).toEqual(cancelResponse("x"));
    expect(reduceExtensionUI(initialExtensionUI, { type: "request", request: future, sessionKey: "s1", at: 0 })).toBe(initialExtensionUI);
  });

  it("are not answered when they carry no id, and known methods never are", () => {
    expect(unhandledResponse(request({ method: "pickColor" }))).toBeUndefined();
    expect(unhandledResponse(request({ id: "n", method: "notify", message: "hi" }))).toBeUndefined();
    expect(unhandledResponse(request({ id: "c", method: "confirm", title: "?", message: "" }))).toBeUndefined();
  });
});

describe("fire-and-forget methods", () => {
  it("keys status and widgets, strips ANSI, and clears them when the value is omitted", () => {
    let state = receive(initialExtensionUI, { id: "1", method: "setStatus", statusKey: "meter", statusText: "\u001b[32m42 tok/s\u001b[0m" });
    state = receive(state, { id: "2", method: "setStatus", statusKey: "router", statusText: "jev: auto" });
    state = receive(state, { id: "3", method: "setStatus", statusKey: "meter", statusText: "40 tok/s" });
    expect(state.statuses).toEqual([
      { key: "meter", text: "40 tok/s" },
      { key: "router", text: "jev: auto" },
    ]);
    state = receive(state, { id: "4", method: "setStatus", statusKey: "meter" });
    expect(state.statuses.map((status) => status.key)).toEqual(["router"]);

    state = receive(state, { id: "5", method: "setWidget", widgetKey: "w", widgetLines: ["\u001b[1mIndex\u001b[22m", "ok"] });
    expect(state.widgets).toEqual([{ key: "w", lines: ["Index", "ok"], placement: "aboveEditor" }]);
    state = receive(state, { id: "6", method: "setWidget", widgetKey: "w", widgetLines: undefined });
    expect(state.widgets).toEqual([]);
  });

  it("sets the title and editor text, and turns notifications and extension errors into notices", () => {
    const state = run(
      { type: "request", request: request({ id: "t", method: "setTitle", title: "pi - orchard" }), sessionKey: "s1", at: 0 },
      { type: "request", request: request({ id: "e", method: "set_editor_text", text: "/review" }), sessionKey: "s1", at: 0 },
      { type: "request", request: request({ id: "n", method: "notify", message: "Command blocked", notifyType: "warning" }), sessionKey: "s1", at: 0 },
      { type: "extension_error", id: "err", error: { type: "extension_error", extensionPath: "/x/ext/meter.ts", event: "turn_end", error: "boom" } },
    );
    expect(state.title).toBe("pi - orchard");
    expect(state.editorText).toEqual({ id: "e", text: "/review" });
    expect(state.notices).toEqual([
      { id: "n", level: "warning", message: "Command blocked" },
      { id: "err", level: "warning", message: "meter.ts: boom" },
    ]);
  });
});

describe("stripAnsi", () => {
  it("removes colour, cursor, and OSC sequences and keeps the text", () => {
    expect(stripAnsi("\u001b[1;38;5;208mhot\u001b[0m \u001b[2Kline")).toBe("hot line");
    expect(stripAnsi("\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007")).toBe("link");
    expect(stripAnsi("plain")).toBe("plain");
  });
});
