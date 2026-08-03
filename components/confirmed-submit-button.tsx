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
}: {
  label: string;
  title: string;
  description: string;
  className?: string;
  destructive?: boolean;
  requireReason?: boolean;
  reasonName?: string;
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
            <label htmlFor={`reason-${reasonName}`}>Reason</label>
            <textarea
              autoFocus
              className="textarea"
              id={`reason-${reasonName}`}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Enter a short audit reason"
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
