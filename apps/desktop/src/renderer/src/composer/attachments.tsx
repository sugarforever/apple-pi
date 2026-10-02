import React from "react";
import { X } from "lucide-react";
import type { ImageContent } from "../pi/types.js";
import { imageUrl } from "./prompt.js";

/** An image waiting in the composer, sent as Pi `ImageContent` with the next message. */
export interface Attachment {
  id: string;
  name: string;
  image: ImageContent;
}

export function Attachments({ items, onRemove }: { items: readonly Attachment[]; onRemove(id: string): void }) {
  if (items.length === 0) return null;
  return (
    <ul className="composer-attachments" aria-label="Attachments">
      {items.map((item) => (
        <li key={item.id} className="composer-attachment">
          <img src={imageUrl(item.image)} alt={item.name} />
          <button type="button" className="composer-attachment-remove" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}>
            <X size={12} strokeWidth={2.5} />
          </button>
        </li>
      ))}
    </ul>
  );
}
