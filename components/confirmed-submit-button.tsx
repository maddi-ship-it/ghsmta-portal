"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { RegalConfirmDialog } from "@/components/regal-confirm-dialog";

export function ConfirmedSubmitButton({
  label,
  title,
  description,
  className = "button button-secondary",
  destructive = false,
  requireReason = false,
  reasonName = "void_reason",
  reasonLabel = "Reason",
  reasonPlaceholder = "Enter a short audit reason",
  reasonMaxLength = 500,
}: {
  label: string;
  title: string;
  description: string;
  className?: string;
  destructive?: boolean;
  requireReason?: boolean;
  reasonName?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonMaxLength?: number;
}) {
  const { pending } = useFormStatus();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  function submitConfirmed() {
    if (requireReason && reason.trim().length < 3) return;
    const form = buttonRef.current?.form;
    if (!form) return;
    setOpen(false);
    form.requestSubmit();
  }

  return (
    <>
      {requireReason ? (
        <input name={reasonName} type="hidden" value={reason.trim()} />
      ) : null}
      <button
        className={className}
        disabled={pending}
        onClick={() => setOpen(true)}
        ref={buttonRef}
        type="button"
      >
        {pending ? "Working…" : label}
      </button>
      <RegalConfirmDialog
        confirmDisabled={requireReason && reason.trim().length < 3}
        confirmLabel={label}
        description={description}
        destructive={destructive}
        onCancel={() => setOpen(false)}
        onConfirm={submitConfirmed}
        open={open}
        pending={pending}
        title={title}
      >
        {requireReason ? (
          <div className="field regal-dialog-reason">
            <label htmlFor={`reason-${reasonName}`}>{reasonLabel}</label>
            <textarea
              autoFocus
              className="textarea"
              id={`reason-${reasonName}`}
              maxLength={reasonMaxLength}
              onChange={(event) => setReason(event.target.value)}
              placeholder={reasonPlaceholder}
              rows={3}
              value={reason}
            />
            <small>At least 3 characters are required.</small>
          </div>
        ) : null}
      </RegalConfirmDialog>
    </>
  );
}
