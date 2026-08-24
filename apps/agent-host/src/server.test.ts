import { describe, expect, it } from "vitest";
import { HostServer } from "./server.js";

describe("HostServer", () => {
  it("negotiates protocol version", async () => {
    const server = new HostServer();
    await expect(server.handle({ protocolVersion: 1, requestId: "1", type: "system.hello", payload: {} }))
      .resolves.toMatchObject({ requestId: "1", ok: true, result: { protocolVersion: 1 } });
  });
});
