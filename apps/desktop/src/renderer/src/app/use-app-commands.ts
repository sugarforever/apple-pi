import { useEffect, useRef } from "react";
import type { AppCommand } from "../../../shared/pi-api.js";

/** Runs the matching action for each command the native menu sends. */
export function useAppCommands(actions: Record<AppCommand, () => void>): void {
  // The listener stays subscribed once while always reaching the latest actions.
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  useEffect(() => window.applePi.app.onCommand((command) => latest.current[command]?.()), []);
}
