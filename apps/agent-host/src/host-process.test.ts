import { expect, it, vi } from "vitest";
import { dispatchHostMessage } from "./host-process.js";

it("allows shutdown to complete while a send request is still running", async () => {
  let finishSend!: () => void;
  const sendResponse = new Promise<{ ok: boolean; [key: string]: unknown }>((resolve) => {
    finishSend = () => resolve({ protocolVersion: 1, requestId: "send", ok: true, result: { opened: false, messages: [], running: false } });
  });
  const server = {
    handle: vi.fn((message: unknown) => (message as { type: string }).type === "session.send"
      ? sendResponse
      : Promise.resolve({ protocolVersion: 1, requestId: "shutdown", ok: true, result: {} })),
  };
  const written: unknown[] = [];
  const exit = vi.fn();

  const sending = dispatchHostMessage(server, { type: "session.send" }, async (response) => { written.push(response); }, exit);
  const shuttingDown = dispatchHostMessage(server, { type: "system.shutdown" }, async (response) => { written.push(response); }, exit);
  await shuttingDown;

  expect(written).toEqual([{ protocolVersion: 1, requestId: "shutdown", ok: true, result: {} }]);
  expect(exit).toHaveBeenCalledOnce();

  finishSend();
  await sending;
});

it("does not treat a rejected raw shutdown-shaped message as accepted", async () => {
  const server = {
    handle: vi.fn(async () => ({ protocolVersion: 1, requestId: "shutdown", ok: false, error: "Invalid host message payload" })),
  };
  const exit = vi.fn();

  await dispatchHostMessage(server, { type: "system.shutdown", payload: { force: true } }, async () => {}, exit);

  expect(exit).not.toHaveBeenCalled();
});
