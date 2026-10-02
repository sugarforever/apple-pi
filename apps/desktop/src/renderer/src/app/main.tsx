import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "../theme/tokens.css";
import "../theme/base.css";
import "./app.css";

const root = createRoot(document.getElementById("root")!);
const fixture = new URLSearchParams(window.location.search).get("visual-fixture");

if (fixture) {
  void import("../fixtures/conversation-fixtures.js").then(({ ConversationFixture }) => root.render(<ConversationFixture id={fixture} />));
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
