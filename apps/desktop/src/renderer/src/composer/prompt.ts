import type { ImageContent, PromptCommand, SlashCommand } from "../pi/types.js";

/**
 * Builds Pi's `prompt` command from the composer. While Pi is running the
 * message is queued: as a steer by default, or as a follow-up when asked.
 */
export function buildPrompt(message: string, images: readonly ImageContent[], options: { running: boolean; followUp?: boolean }): PromptCommand {
  const command: PromptCommand = { type: "prompt", message };
  if (images.length > 0) command.images = [...images];
  if (options.running) command.streamingBehavior = options.followUp ? "followUp" : "steer";
  return command;
}

/** The text after "/" while the draft is still a bare command name, or undefined. */
export function slashQuery(draft: string): string | undefined {
  return /^\/(\S*)$/.exec(draft)?.[1];
}

/** Commands whose name contains the query, names that start with it first. */
export function filterCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const needle = query.toLowerCase();
  const rank = (command: SlashCommand) => {
    const name = command.name.toLowerCase();
    if (name.startsWith(needle)) return 0;
    // Skills are named `skill:<name>`; typing the bare name should find them as well.
    if (name.replace(/^skill:/, "").startsWith(needle)) return 1;
    return name.includes(needle) ? 2 : -1;
  };
  return commands
    .map((command) => ({ command, rank: rank(command) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.command);
}

/** Reads an image file into Pi's `ImageContent`: base64 data without the data-URL prefix. */
export function readImage(file: File): Promise<ImageContent> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ type: "image", data: url.slice(url.indexOf(",") + 1), mimeType: file.type });
    };
    reader.readAsDataURL(file);
  });
}

export const imageUrl = (image: ImageContent): string => `data:${image.mimeType};base64,${image.data}`;
