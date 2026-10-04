import React, { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check } from "lucide-react";
import "./menu.css";

const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)';

const menuItems = (menu: HTMLElement | null): HTMLElement[] => [...(menu?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];

export interface MenuState {
  open: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
  /** Closes the menu and returns focus to its trigger. */
  close(): void;
  /** Wraps the trigger and the menu; a press outside it closes the menu. */
  rootRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  /** Arrow, Home/End, Escape, and Tab handling for the open menu. */
  onMenuKey(event: KeyboardEvent): void;
  /** Focuses the checked item, or the first, once the menu's items are rendered. */
  focusItem(): void;
}

/** Open state, outside-press dismissal, and keyboard movement for a popup menu. */
export function useMenu(initiallyOpen = false): MenuState {
  const [open, setOpen] = useState(initiallyOpen);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  const focusItem = useCallback(() => {
    const items = menuItems(menu.current);
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
  }, []);

  const onMenuKey = useCallback(
    (event: KeyboardEvent) => {
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
        // From the trigger, the browser's own Tab moves on to the next control instead of losing focus with the menu.
        trigger.current?.focus();
        setOpen(false);
      }
    },
    [close],
  );

  const toggle = useCallback(() => setOpen((value) => !value), []);

  return { open, setOpen, toggle, close, rootRef: root, triggerRef: trigger, menuRef: menu, onMenuKey, focusItem };
}

export interface MenuItemProps {
  label: ReactNode;
  icon?: ReactNode;
  /** Present for radio items: whether this one is the current choice. */
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onSelect(): void;
}

export function MenuItem({ label, icon, checked, disabled, danger, onSelect }: MenuItemProps) {
  const radio = checked !== undefined;
  return (
    <button
      type="button"
      role={radio ? "menuitemradio" : "menuitem"}
      aria-checked={radio ? checked : undefined}
      className={danger ? "menu-item menu-item-danger" : "menu-item"}
      tabIndex={-1}
      disabled={disabled}
      onClick={onSelect}
    >
      {icon && <span className="menu-item-icon">{icon}</span>}
      <span className="menu-item-label">{label}</span>
      {checked && <Check size={14} aria-hidden />}
    </button>
  );
}
