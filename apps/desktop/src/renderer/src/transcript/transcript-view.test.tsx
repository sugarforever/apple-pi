import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../pi/types.js";
import { assistant, text, toolCall, toolResult, user } from "../fixtures/sample-messages.js";
import { initialTranscript } from "./reducer.js";
import { TranscriptView } from "./transcript-view.js";

describe("TranscriptView", () => {
  it("renders a finished turn collapsed with its markdown answer, and survives unknown messages", () => {
    const call = toolCall("c1", "bash", { command: "pnpm test" });
    const html = renderToStaticMarkup(
      <TranscriptView
        state={{
          ...initialTranscript,
          messages: [
            user("Run the tests", 0),
            assistant([call], 1_000, "toolUse"),
            toolResult(call, "ok", 2_000),
            { role: "hologram", timestamp: 3_000 } as unknown as AgentMessage,
            assistant([text("All green. Run `pnpm test` again with:\n\n```sh\npnpm test\n```")], 12_000),
          ],
        }}
      />,
    );
    expect(html).toContain("Run the tests");
    expect(html).toContain("Worked for 12s");
    // Collapsed: the tool row is not rendered until the turn is expanded.
    expect(html).not.toContain("Ran pnpm test");
    expect(html).toContain("<code>pnpm test</code>");
    expect(html).toContain('class="code-block"');
    expect(html).toContain(">sh<");
  });
});
