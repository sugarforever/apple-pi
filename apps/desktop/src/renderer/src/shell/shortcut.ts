const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

/** A menu shortcut as the platform writes it, for tooltips: `shortcut("N")` is ⌘N or Ctrl+N. */
export const shortcut = (key: string, shift = false): string => (isMac ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`);
