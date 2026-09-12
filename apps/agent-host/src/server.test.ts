import { describe, expect, it } from "vitest";
import hostPackage from "../package.json" with { type: "json" };
import { HOST_VERSION, HostServer } from "./server.js";

describe("HostServer", () => {
  it("reports exact versions and named capabilities", async () => {
    expect(HOST_VERSION).toBe(hostPackage.version);
    const server = new HostServer();
    await expect(server.handle({ protocolVersion: 1, requestId: "1", type: "system.hello", payload: {} }))
      .resolves.toEqual({
        protocolVersion: 1,
        requestId: "1",
        ok: true,
        result: {
          protocolVersion: 1,
          hostVersion: "0.1.0",
          piVersion: "0.84.2",
          capabilities: { sessionEvents: true, modelSelection: true },
          pid: process.pid,
        },
      });
  });
});
