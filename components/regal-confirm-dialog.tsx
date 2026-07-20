"use client";

import { useEffect, useRef } from "react";

export function RegalConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  pending = false,
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
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    cancelButtonRef.current?.focus();

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onCancel();
      }
    }

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onCancel, open, pending]);

  if (!open) return null;

  return (
    <div
      aria-labelledby="regal-confirm-title"
      aria-modal="true"
      className="regal-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !pending) {
          onCancel();
        }
      }}
      role="dialog"
    >
      <section className="regal-dialog-card">
        <div className="regal-dialog-mark" aria-hidden="true">
          {destructive ? "!" : "✓"}
        </div>

        <div className="regal-dialog-copy">
          <span className="eyebrow">
            {destructive ? "Please confirm" : "Confirmation"}
          </span>
          <h2 id="regal-confirm-title">{title}</h2>
          <p>{description}</p>
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
            disabled={pending}
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
