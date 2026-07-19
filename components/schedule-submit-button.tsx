"use client";

import { useFormStatus } from "react-dom";

type ScheduleSubmitButtonProps = {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
};

export function ScheduleSubmitButton({
  children,
  pendingLabel = "Saving…",
  className = "button button-dark",
  disabled = false,
}: ScheduleSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button className={className} disabled={disabled || pending} type="submit">
      {pending ? pendingLabel : children}
    </button>
  );
}
