"use client";

import { useFormStatus } from "react-dom";

type ScheduleSubmitButtonProps = {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  formAction?: React.ComponentProps<"button">["formAction"];
  formNoValidate?: boolean;
  name?: string;
  value?: string;
};

export function ScheduleSubmitButton({
  children,
  pendingLabel = "Saving…",
  className = "button button-dark",
  disabled = false,
  formAction,
  formNoValidate = false,
  name,
  value,
}: ScheduleSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      className={className}
      disabled={disabled || pending}
      formAction={formAction}
      formNoValidate={formNoValidate}
      name={name}
      type="submit"
      value={value}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
