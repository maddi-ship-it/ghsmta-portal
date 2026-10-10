"use client";

import { useEffect, useId, useRef, useState } from "react";

export type ApplicationReferenceMenuItem = {
  key: string;
  label: string;
  title?: string;
};

export function ApplicationReferenceMenu({
  ariaLabel,
  className = "",
  items,
  label,
  onSelect,
}: {
  ariaLabel: string;
  className?: string;
  items: ApplicationReferenceMenuItem[];
  label: string;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div
      className={`application-reference-menu-shell ${className}`.trim()}
      ref={menuRef}
    >
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={ariaLabel}
        className="application-reference-button application-reference-menu-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="application-reference-menu-chevron">
          ▾
        </span>
      </button>

      <div
        className="application-reference-menu-popover"
        hidden={!open}
        id={menuId}
      >
        {items.map((item) => (
          <button
            className="application-reference-menu-option"
            key={item.key}
            onClick={() => {
              setOpen(false);
              onSelect(item.key);
            }}
            title={item.title}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
