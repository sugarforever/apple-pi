import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { installGracefulShutdown } from "./graceful-shutdown.js";

it("holds the first quit until one shared host shutdown completes", async () => {
  const events = new EventEmitter();
  const app = Object.assign(events, { quit: vi.fn() });
  let release!: () => void;
  const stop = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  installGracefulShutdown(app, { stop });
  const first = { preventDefault: vi.fn() };
  const repeated = { preventDefault: vi.fn() };

  app.emit("before-quit", first);
  app.emit("before-quit", repeated);
  expect(first.preventDefault).toHaveBeenCalledOnce();
  expect(repeated.preventDefault).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  expect(app.quit).not.toHaveBeenCalled();

  release();
  await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce());
  const final = { preventDefault: vi.fn() };
  app.emit("before-quit", final);
  expect(final.preventDefault).not.toHaveBeenCalled();
});
