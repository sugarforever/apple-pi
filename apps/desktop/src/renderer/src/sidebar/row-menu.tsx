import React, { useEffect } from "react";
import { Ellipsis } from "lucide-react";
import { MenuItem, useMenu, type MenuItemProps } from "../menu/menu.js";

/** The "…" button a sidebar row reveals on hover, and its menu. */
export function RowMenu({ label, items }: { label: string; items: (MenuItemProps & { key: string })[] }) {
  const { open, close, focusItem, toggle, rootRef, triggerRef, menuRef, onMenuKey } = useMenu();
  useEffect(() => {
    if (open) focusItem();
  }, [open, focusItem]);

  return (
    <div className="row-menu" ref={rootRef} data-open={open || undefined}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button row-menu-trigger"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Ellipsis size={16} />
      </button>
      {open && (
        <div ref={menuRef} className="menu row-menu-popup" role="menu" aria-label={label} onKeyDown={onMenuKey}>
          {items.map(({ key, onSelect, ...item }) => (
            <MenuItem
              key={key}
              {...item}
              onSelect={() => {
                close();
                onSelect();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
