import React from "react";
import type { ModelItem, ModelRef } from "../global.js";

export const modelKey = (model: ModelRef): string => `${model.provider}::${model.modelId}`;

export const parseModelKey = (value: string): ModelRef => {
  const [provider, modelId] = value.split("::");
  return { provider: provider!, modelId: modelId! };
};

export function ModelSelect(props: {
  id?: string;
  ariaLabel?: string;
  models: Map<string, ModelItem[]>;
  value: string;
  onChange(value: string): void;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={props.id}
      aria-label={props.ariaLabel}
      className="model-select"
      value={props.value}
      disabled={props.disabled ?? false}
      onChange={(event) => props.onChange(event.target.value)}
    >
      <option value="">{props.emptyLabel ?? "Select model"}</option>
      {[...props.models].map(([provider, items]) => (
        <optgroup key={provider} label={provider}>
          {items.map((model) => (
            <option key={modelKey(model)} value={modelKey(model)}>
              {model.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
