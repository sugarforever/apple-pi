import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Zap } from "lucide-react";
import { MenuItem, useMenu } from "../menu/menu.js";
import type { Model, ThinkingLevel } from "../pi/types.js";

const LEVEL_LABEL: Partial<Record<ThinkingLevel, string>> = { xhigh: "Extra high" };
const levelLabel = (level: string) => LEVEL_LABEL[level as ThinkingLevel] ?? level.charAt(0).toUpperCase() + level.slice(1);

export interface ModelOptions {
  models: Model[];
  /** Thinking levels the current model supports; `["off"]` when it does not reason. */
  levels: ThinkingLevel[];
}

export interface ModelPickerProps {
  model?: Model;
  thinkingLevel?: ThinkingLevel;
  /** Fetches the menu's choices each time it opens, so new credentials or models show up. */
  load(): Promise<ModelOptions>;
  onSelectModel(model: Model): void;
  onSelectThinking(level: ThinkingLevel): void;
}

const sameModel = (a: Model | undefined, b: Model) => a?.provider === b.provider && a.id === b.id;

/** The composer's model chip and its menu: models by provider, then thinking levels. */
export function ModelPicker({ model, thinkingLevel, load, onSelectModel, onSelectThinking }: ModelPickerProps) {
  const { open, setOpen, focusItem, toggle, close, rootRef, triggerRef, menuRef, onMenuKey } = useMenu();
  const [options, setOptions] = useState<ModelOptions>();
  const [error, setError] = useState("");
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });

  useEffect(() => {
    if (!open) return;
    let current = true;
    loader
      .current()
      .then((loaded) => {
        if (!current) return;
        setOptions(loaded);
        setError("");
      })
      .catch((reason: unknown) => current && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      current = false;
    };
  }, [open]);

  // Once the choices are in, put focus on the checked one so arrows start from there.
  useEffect(() => {
    if (open && options) focusItem();
  }, [open, options, focusItem]);

  const providers = groupByProvider(options?.models ?? []);
  const levels = options?.levels ?? [];

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="model-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Zap size={14} fill="currentColor" aria-hidden />
        <span className="model-chip-name">{model ? model.name || model.id : "Choose model"}</span>
        {model?.reasoning && thinkingLevel && <span className="model-chip-level">{levelLabel(thinkingLevel)}</span>}
        <ChevronDown size={14} aria-hidden className="model-chip-chevron" />
      </button>
      {open && (
        <div ref={menuRef} className="menu model-menu" role="menu" aria-label="Model and thinking" onKeyDown={onMenuKey}>
          {error && <p className="menu-empty">{error}</p>}
          {!options && !error && <p className="menu-empty">Loading models…</p>}
          {options && providers.length === 0 && <p className="menu-empty">No models are set up. Use /login in Pi's terminal app.</p>}
          {providers.map(([provider, models]) => (
            <div key={provider} role="group" aria-label={provider}>
              <div className="menu-heading">{provider}</div>
              {models.map((item) => (
                <MenuItem
                  key={item.id}
                  label={item.name || item.id}
                  checked={sameModel(model, item)}
                  onSelect={() => {
                    onSelectModel(item);
                    close();
                  }}
                />
              ))}
            </div>
          ))}
          {levels.length > 1 && (
            <div role="group" aria-label="Thinking">
              <div className="menu-heading">Thinking</div>
              {levels.map((level) => (
                <MenuItem
                  key={level}
                  label={levelLabel(level)}
                  checked={level === thinkingLevel}
                  onSelect={() => {
                    onSelectThinking(level);
                    close();
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function groupByProvider(models: readonly Model[]): [string, Model[]][] {
  const groups = new Map<string, Model[]>();
  for (const model of models) groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
  return [...groups];
}
