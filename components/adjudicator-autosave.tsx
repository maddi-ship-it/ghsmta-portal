"use client";

import { useEffect, useRef, useState } from "react";

import { autosaveAdjudicatorScorecard } from "@/app/portal/adjudication/[id]/actions";

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

export function AdjudicatorAutosave({
  applicationId,
  disabled = false,
}: {
  applicationId: string;
  disabled?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const [state, setState] = useState<SaveState>(disabled ? "idle" : "saved");
  const [message, setMessage] = useState(
    disabled ? "Submitted scorecards are read-only." : "Autosave is on.",
  );

  useEffect(() => {
    if (disabled) return;

    const form = hostRef.current?.closest("form");
    if (!form) return;

    let disposed = false;

    const runSave = async () => {
      if (disposed) return;

      if (inFlightRef.current) {
        queuedRef.current = true;
        return;
      }

      inFlightRef.current = true;
      queuedRef.current = false;
      setState("saving");
      setMessage("Saving changes…");

      const result = await autosaveAdjudicatorScorecard(
        applicationId,
        new FormData(form),
      );

      inFlightRef.current = false;
      if (disposed) return;

      if (result.ok) {
        setState("saved");
        setMessage(
          `Saved ${new Date(result.savedAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          })}`,
        );
      } else {
        setState("error");
        setMessage(result.error ?? "Autosave failed.");
      }

      if (queuedRef.current) {
        void runSave();
      }
    };

    const scheduleSave = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setState("pending");
      setMessage("Unsaved changes");
      timerRef.current = setTimeout(() => void runSave(), 900);
    };

    form.addEventListener("input", scheduleSave);
    form.addEventListener("change", scheduleSave);

    return () => {
      disposed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      form.removeEventListener("input", scheduleSave);
      form.removeEventListener("change", scheduleSave);
    };
  }, [applicationId, disabled]);

  return (
    <div
      className={`autosave-status autosave-status-${state}`}
      ref={hostRef}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" />
      {message}
    </div>
  );
}
