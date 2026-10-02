import React, { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Zap } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ModelOptions>();
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
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
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => {
      current = false;
      document.removeEventListener("mousedown", closeOutside);
    };
  }, [open]);

  // Once the choices are in, put focus on the checked one so arrows start from there.
  useEffect(() => {
    if (!open || !options) return;
    const items = menuItems(menu.current);
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
  }, [open, options]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onMenuKey = (event: KeyboardEvent) => {
    const items = menuItems(menu.current);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key];
    if (move !== undefined) {
      event.preventDefault();
      items[(move + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const providers = groupByProvider(options?.models ?? []);
  const levels = options?.levels ?? [];

  return (
    <div className="model-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="model-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
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
        <div ref={menu} className="composer-menu model-menu" role="menu" aria-label="Model and thinking" onKeyDown={onMenuKey}>
          {error && <p className="composer-menu-empty">{error}</p>}
          {!options && !error && <p className="composer-menu-empty">Loading models…</p>}
          {options && providers.length === 0 && <p className="composer-menu-empty">No models are set up. Use /login in Pi's terminal app.</p>}
          {providers.map(([provider, models]) => (
            <div key={provider} role="group" aria-label={provider}>
              <div className="composer-menu-heading">{provider}</div>
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
              <div className="composer-menu-heading">Thinking</div>
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

function MenuItem({ label, checked, onSelect }: { label: string; checked: boolean; onSelect(): void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} className="composer-menu-item" tabIndex={-1} onClick={onSelect}>
      <span>{label}</span>
      {checked && <Check size={14} aria-hidden />}
    </button>
  );
}

const menuItems = (menu: HTMLElement | null): HTMLElement[] => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];

function groupByProvider(models: readonly Model[]): [string, Model[]][] {
  const groups = new Map<string, Model[]>();
  for (const model of models) groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
  return [...groups];
}
