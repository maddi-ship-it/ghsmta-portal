"use client";

import { useEffect, useRef, useState } from "react";

import { autosaveAdjudicatorScorecard } from "@/app/portal/adjudication/[id]/actions";

type SaveState = "idle" | "pending" | "saving" | "saved" | "offline" | "error";

type OfflineScorecardDraft = {
  applicationId: string;
  savedAt: string;
  values: Record<string, string>;
};

export function offlineScorecardDraftKey(applicationId: string) {
  return `ghsmta:offline-scorecard-draft:${applicationId}`;
}

function broadcastOfflineDraftChange(applicationId: string, hasDraft: boolean) {
  window.dispatchEvent(
    new CustomEvent("ghsmta:offline-scorecard-draft-changed", {
      detail: { applicationId, hasDraft },
    }),
  );
}

function namedControls(form: HTMLFormElement) {
  return Array.from(form.elements).filter(
    (element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement,
  ).filter((element) => Boolean(element.name) && element.type !== "file");
}

function formValues(form: HTMLFormElement) {
  const values: Record<string, string> = {};

  for (const element of namedControls(form)) {
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
      values[element.name] = element.checked ? element.value || "on" : "";
      continue;
    }

    values[element.name] = element.value;
  }

  return values;
}

function writeOfflineDraft(applicationId: string, form: HTMLFormElement) {
  const draft: OfflineScorecardDraft = {
    applicationId,
    savedAt: new Date().toISOString(),
    values: formValues(form),
  };
  window.localStorage.setItem(offlineScorecardDraftKey(applicationId), JSON.stringify(draft));
  broadcastOfflineDraftChange(applicationId, true);
  return draft;
}

function readOfflineDraft(applicationId: string) {
  try {
    const raw = window.localStorage.getItem(offlineScorecardDraftKey(applicationId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as OfflineScorecardDraft;
    return draft.applicationId === applicationId ? draft : null;
  } catch {
    return null;
  }
}

function clearOfflineDraft(applicationId: string) {
  window.localStorage.removeItem(offlineScorecardDraftKey(applicationId));
  broadcastOfflineDraftChange(applicationId, false);
}

function restoreOfflineDraft(form: HTMLFormElement, draft: OfflineScorecardDraft) {
  for (const element of namedControls(form)) {
    if (!(element.name in draft.values)) continue;
    const value = draft.values[element.name] ?? "";

    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
      element.checked = value !== "";
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  window.dispatchEvent(
    new CustomEvent("ghsmta:offline-draft-restore", {
      detail: { applicationId: draft.applicationId, values: draft.values },
    }),
  );
}

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
  const restoredRef = useRef(false);
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
      setMessage("Syncing comments…");

      if (!navigator.onLine) {
        writeOfflineDraft(applicationId, form);
        inFlightRef.current = false;
        setState("offline");
        setMessage("Offline — comments saved on this device.");
        return;
      }

      let result: Awaited<ReturnType<typeof autosaveAdjudicatorScorecard>>;
      try {
        result = await autosaveAdjudicatorScorecard(
          applicationId,
          new FormData(form),
        );
      } catch (error) {
        writeOfflineDraft(applicationId, form);
        inFlightRef.current = false;
        setState(navigator.onLine ? "error" : "offline");
        setMessage(
          navigator.onLine
            ? error instanceof Error
              ? `Server sync failed — comments are saved on this device. ${error.message}`
              : "Server sync failed — comments are saved on this device."
            : "Offline — comments saved on this device.",
        );
        return;
      }

      inFlightRef.current = false;
      if (disposed) return;

      if (result.ok) {
        clearOfflineDraft(applicationId);
        setState("saved");
        setMessage(
          `All comments synced ${new Date(result.savedAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          })}`,
        );
      } else {
        writeOfflineDraft(applicationId, form);
        setState("error");
        setMessage(result.error ? `Comments saved on this device. ${result.error}` : "Comments saved on this device. Autosave failed.");
      }

      if (queuedRef.current) {
        void runSave();
      }
    };

    const scheduleSave = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      writeOfflineDraft(applicationId, form);
      setState(navigator.onLine ? "pending" : "offline");
      setMessage(
        navigator.onLine
          ? "Unsaved changes — local safety copy created."
          : "Offline — comments saved on this device.",
      );
      timerRef.current = setTimeout(() => void runSave(), 900);
    };

    const syncStoredDraft = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const draft = readOfflineDraft(applicationId);
      if (!draft) return;
      setState(navigator.onLine ? "saving" : "offline");
      setMessage(
        navigator.onLine
          ? "Back online — syncing saved comments…"
          : "Offline — comments saved on this device.",
      );
      if (navigator.onLine) {
        timerRef.current = setTimeout(() => void runSave(), 250);
      }
    };

    const markOffline = () => {
      writeOfflineDraft(applicationId, form);
      setState("offline");
      setMessage("Offline — comments saved on this device.");
    };

    if (!restoredRef.current) {
      const draft = readOfflineDraft(applicationId);
      if (draft) {
        restoredRef.current = true;
        restoreOfflineDraft(form, draft);
        window.setTimeout(() => {
          if (disposed) return;
          setState(navigator.onLine ? "pending" : "offline");
          setMessage(
            navigator.onLine
              ? "Restored unsynced comments — syncing now…"
              : "Restored offline comments saved on this device.",
          );
        }, 0);
        timerRef.current = setTimeout(() => void runSave(), navigator.onLine ? 350 : 900);
      }
    }

    form.addEventListener("input", scheduleSave);
    form.addEventListener("change", scheduleSave);
    window.addEventListener("online", syncStoredDraft);
    window.addEventListener("offline", markOffline);

    return () => {
      disposed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      form.removeEventListener("input", scheduleSave);
      form.removeEventListener("change", scheduleSave);
      window.removeEventListener("online", syncStoredDraft);
      window.removeEventListener("offline", markOffline);
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
