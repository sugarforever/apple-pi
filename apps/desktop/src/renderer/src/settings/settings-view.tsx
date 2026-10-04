import React from "react";
import { FileCog } from "lucide-react";
import "./settings.css";

/** Pi's CLI owns configuration; the app only points at it. */
const CLI_HINTS: { command: string; description: string }[] = [
  { command: "pi config", description: "Turn extensions, skills, prompt templates, and themes on or off." },
  { command: "pi install <package>", description: "Add a Pi package from npm or git." },
  { command: "/login", description: "Sign in to a model provider from Pi in a terminal." },
];

export interface SettingsViewProps {
  piVersion: string;
  appVersion: string;
  onOpenSettingsFile(): void;
}

/** What Apple Pi Lite runs and where Pi's own settings live. Everything else is Pi's. */
export function SettingsView({ piVersion, appVersion, onOpenSettingsFile }: SettingsViewProps) {
  return (
    <main className="settings">
      <div className="settings-column">
        <h1 className="settings-heading">Settings</h1>
        <section className="settings-section" aria-labelledby="settings-about">
          <h2 id="settings-about" className="settings-section-title">
            About
          </h2>
          <dl className="settings-card">
            <div className="settings-row">
              <dt>Pi</dt>
              <dd className="settings-mono">{piVersion}</dd>
            </div>
            <div className="settings-row">
              <dt>Apple Pi Lite</dt>
              <dd className="settings-mono">{appVersion}</dd>
            </div>
          </dl>
        </section>
        <section className="settings-section" aria-labelledby="settings-pi">
          <h2 id="settings-pi" className="settings-section-title">
            Pi settings
          </h2>
          <div className="settings-card">
            <div className="settings-row">
              <div>
                <div>settings.json</div>
                <p className="settings-note">Default model, thinking level, compaction, and the rest of Pi's settings.</p>
              </div>
              <button type="button" className="settings-button" onClick={onOpenSettingsFile}>
                <FileCog size={15} aria-hidden />
                Open settings.json
              </button>
            </div>
          </div>
        </section>
        <section className="settings-section" aria-labelledby="settings-cli">
          <h2 id="settings-cli" className="settings-section-title">
            From the command line
          </h2>
          <ul className="settings-card settings-hints">
            {CLI_HINTS.map((hint) => (
              <li key={hint.command} className="settings-row">
                <code className="settings-chip">{hint.command}</code>
                <span className="settings-note">{hint.description}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
