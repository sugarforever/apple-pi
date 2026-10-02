/** What a row of agent activity did, used for its label and group summaries. */
export type ActivityVerb = "ran" | "read" | "edited" | "wrote" | "searched" | "listed" | "used" | "thought";

const verbs: Record<ActivityVerb, { past: string; live: string; one: string; many: string }> = {
  ran: { past: "Ran", live: "Running", one: "ran a command", many: "ran # commands" },
  read: { past: "Read", live: "Reading", one: "read a file", many: "read # files" },
  edited: { past: "Edited", live: "Editing", one: "edited a file", many: "edited # files" },
  wrote: { past: "Wrote", live: "Writing", one: "wrote a file", many: "wrote # files" },
  searched: { past: "Searched for", live: "Searching for", one: "searched the code", many: "searched the code # times" },
  listed: { past: "Listed", live: "Listing", one: "listed files", many: "listed files # times" },
  used: { past: "Used", live: "Using", one: "used a tool", many: "used # tools" },
  thought: { past: "Thought", live: "Thinking", one: "thought", many: "thought" },
};

const toolVerbs: Record<string, ActivityVerb> = { bash: "ran", read: "read", edit: "edited", write: "wrote", grep: "searched", find: "listed", ls: "listed" };

export const toolVerb = (name: string): ActivityVerb => toolVerbs[name] ?? "used";

const stringArg = (args: unknown, key: string): string | undefined => {
  const value = (args as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

/** The object of a tool row's sentence: the command, path, or pattern it acted on. */
export function toolTarget(name: string, args: unknown): string {
  switch (name) {
    case "bash":
      return stringArg(args, "command")?.split("\n")[0] ?? "a command";
    case "read":
    case "edit":
    case "write":
      return stringArg(args, "path") ?? "a file";
    case "grep":
      return stringArg(args, "pattern") ?? "text";
    case "find":
      return stringArg(args, "pattern") ?? stringArg(args, "path") ?? ".";
    case "ls":
      return stringArg(args, "path") ?? ".";
    default:
      return name;
  }
}

export function rowLabel(verb: ActivityVerb, target: string, live: boolean): string {
  const word = live ? verbs[verb].live : verbs[verb].past;
  return target ? `${word} ${target}` : word;
}

/** "Ran 3 commands, read a file" for a group of rows, in order of first appearance. */
export function summarize(rowVerbs: ActivityVerb[]): string {
  const counts = new Map<ActivityVerb, number>();
  for (const verb of rowVerbs) counts.set(verb, (counts.get(verb) ?? 0) + 1);
  const phrase = [...counts].map(([verb, count]) => (count === 1 ? verbs[verb].one : verbs[verb].many.replace("#", String(count)))).join(", ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
