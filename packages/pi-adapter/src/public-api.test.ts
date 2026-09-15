import { describe, expect, expectTypeOf, it } from "vitest";
import type { ApplePiMessage, ApplePiSessionEvent, CustomProviderDefinition, ModelItem, SessionItem, SessionSnapshot } from "@apple-pi/protocol";
import { mapPiEvent, mapPiMessages, mapPiModel, mapPiSessionItem, type PiProviderService, type PiSessionService } from "./index.js";

describe("Pi adapter public API", () => {
  it("exports mappers whose outputs are owned by Apple Pi", () => {
    expect(mapPiMessages([])).toEqual([]);
    expectTypeOf(mapPiMessages).returns.toEqualTypeOf<ApplePiMessage[]>();
    expectTypeOf(mapPiEvent).returns.toEqualTypeOf<ApplePiSessionEvent>();
    expectTypeOf(mapPiModel).returns.toEqualTypeOf<ModelItem>();
    expectTypeOf(mapPiSessionItem).returns.toEqualTypeOf<SessionItem>();
  });

  it("exposes explicit Apple Pi service result types", () => {
    expectTypeOf<PiSessionService["listSessions"]>().returns.resolves.toEqualTypeOf<SessionItem[]>();
    expectTypeOf<PiSessionService["listModels"]>().returns.resolves.toEqualTypeOf<ModelItem[]>();
    expectTypeOf<PiSessionService["open"]>().returns.resolves.toEqualTypeOf<SessionSnapshot>();
    expectTypeOf<PiSessionService["setModel"]>().returns.resolves.toEqualTypeOf<SessionSnapshot>();
    expectTypeOf<PiSessionService["snapshot"]>().returns.toEqualTypeOf<SessionSnapshot>();
  });

  it("exposes custom-provider management with non-secret result types", () => {
    expectTypeOf<PiProviderService["listCustomProviders"]>().returns.resolves.toEqualTypeOf<CustomProviderDefinition[]>();
  });
});
