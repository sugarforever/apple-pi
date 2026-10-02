import React, { useEffect, useRef } from "react";
import type { SlashCommand } from "../pi/types.js";
import "../menu/menu.css";

const SOURCE_LABEL: Record<SlashCommand["source"], string> = { extension: "Extension", prompt: "Prompt", skill: "Skill" };

export interface CommandPaletteProps {
  id: string;
  commands: readonly SlashCommand[];
  active: number;
  onPick(command: SlashCommand): void;
  onHover(index: number): void;
}

/**
 * Pi's slash commands matching the draft. Focus stays in the message box, which
 * drives the selection through `aria-activedescendant`.
 */
export function CommandPalette({ id, commands, active, onPick, onHover }: CommandPaletteProps) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <ul ref={list} id={id} className="menu command-palette" role="listbox" aria-label="Commands">
      {commands.length === 0 && <li className="menu-empty">No matching commands</li>}
      {commands.map((command, index) => (
        <li
          key={`${command.source}:${command.name}`}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === active}
          className="command-option"
          // Keep focus in the message box.
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => onHover(index)}
          onClick={() => onPick(command)}
        >
          <span className="command-name">/{command.name}</span>
          {command.description && <span className="command-description">{command.description}</span>}
          <span className="command-source">{SOURCE_LABEL[command.source] ?? command.source}</span>
        </li>
      ))}
    </ul>
  );
}
