import { describe, expect, it } from "vitest";
import manifest from "./visual-fixtures.json";
import { fixtureDefinitions } from "./src/visual-fixtures.js";

describe("renderer visual fixture contract", () => {
  it("pins the three review viewport sizes", () => {
    expect(manifest.viewports).toEqual([
      { width: 1280, height: 800 },
      { width: 960, height: 640 },
      { width: 800, height: 600 },
    ]);
  });

  it("covers each feature and its relevant deterministic states", () => {
    const coverage = fixtureDefinitions.reduce<Record<string, Set<string>>>((result, fixture) => {
      const states = result[fixture.feature] ?? new Set<string>();
      fixture.states.forEach((state) => states.add(state));
      result[fixture.feature] = states;
      return result;
    }, {});

    expect(Object.keys(coverage).sort()).toEqual(["conversation", "providers", "user-skills", "workspace-skills"]);
    expect([...coverage.conversation!].sort()).toEqual(["failure", "focus", "loading", "long-content", "success", "unavailable"]);
    for (const feature of ["providers", "user-skills", "workspace-skills"]) {
      expect([...coverage[feature]!].sort(), feature).toEqual(["empty", "failure", "focus", "loading", "success"]);
    }
  });

  it("keeps capture identifiers and manifest entries in lockstep", () => {
    expect(fixtureDefinitions.map(({ id }) => id)).toEqual(manifest.fixtures);
    expect(new Set(manifest.fixtures).size).toBe(manifest.fixtures.length);
  });
});
