import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsNavigation } from "./settings-navigation.js";

describe("SettingsNavigation", () => {
  it("marks only the current settings section", () => {
    const markup = renderToStaticMarkup(<SettingsNavigation section="providers" onSectionChange={() => undefined} />);

    expect(markup).toContain('aria-label="Settings sections"');
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toContain('aria-current="page">Providers</button>');
  });
});
