"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

export function RegalConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  pending = false,
  confirmDisabled = false,
  wide = false,
  children,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  confirmDisabled?: boolean;
  wide?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const preferredFocus = cardRef.current?.querySelector<HTMLElement>("[autofocus]");
    (preferredFocus ?? cancelButtonRef.current)?.focus();

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onCancel();
      }
      if (event.key === "Tab") {
        const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
      previouslyFocused?.focus();
    };
  }, [onCancel, open, pending]);

  if (!open) return null;

  return (
    <div
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="regal-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !pending) {
          onCancel();
        }
      }}
      role="dialog"
    >
      <section
        className={`regal-dialog-card${wide ? " regal-dialog-card-wide" : ""}`}
        ref={cardRef}
      >
        <div className="regal-dialog-mark" aria-hidden="true">
          {destructive ? "!" : "✓"}
        </div>

        <div className="regal-dialog-copy">
          <span className="eyebrow">
            {destructive ? "Please confirm" : "Confirmation"}
          </span>
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
          {children}
        </div>

        <div className="regal-dialog-actions">
          <button
            className="button button-secondary"
            disabled={pending}
            onClick={onCancel}
            ref={cancelButtonRef}
            type="button"
          >
            {cancelLabel}
          </button>

          <button
            className={
              destructive
                ? "button button-danger"
                : "button button-gold"
            }
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
            type="button"
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
