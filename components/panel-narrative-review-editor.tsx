"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  autosavePanelFeedbackDraft,
  savePanelFeedback,
} from "@/app/portal/adjudication/[id]/actions";

type AutosaveState =
  | "saved"
  | "pending"
  | "saving"
  | "offline"
  | "error";

type StoredPanelDraft = {
  applicationId: string;
  categoryId: string;
  reviewerId: string;
  value: string;
  sourceGeneratedAt: string;
  savedAt: string;
};

export function PanelNarrativeReviewEditor({
  applicationId,
  categoryId,
  currentUserId,
  generatedAt,
  initialValue,
}: {
  applicationId: string;
  categoryId: string;
  currentUserId: string;
  generatedAt: string;
  initialValue: string;
}) {
  const router = useRouter();
  const storageKey = `ghsmta:panel-comment-draft:${currentUserId}:${applicationId}:${categoryId}`;
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef<Promise<{ savedAt: string }> | null>(null);
  const mountedRef = useRef(false);
  const latestValueRef = useRef(initialValue);
  const savedValueRef = useRef(initialValue);
  const sourceGeneratedAtRef = useRef(generatedAt);
  const [value, setValue] = useState(initialValue);
  const [autosaveState, setAutosaveState] =
    useState<AutosaveState>("saved");
  const [message, setMessage] = useState(
    "Changes to this final comment save automatically.",
  );
  const [approving, setApproving] = useState(false);

  const writeLocalDraft = useCallback(
    (draftValue: string) => {
      const draft: StoredPanelDraft = {
        applicationId,
        categoryId,
        reviewerId: currentUserId,
        value: draftValue,
        sourceGeneratedAt: sourceGeneratedAtRef.current,
        savedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
    },
    [applicationId, categoryId, currentUserId, storageKey],
  );

  const clearLocalDraft = useCallback(() => {
    window.localStorage.removeItem(storageKey);
  }, [storageKey]);

  const queueSave = useCallback(
    (draftValue: string) => {
      if (!draftValue.trim()) {
        setAutosaveState("pending");
        setMessage("The final comment cannot be blank. Keep typing to autosave.");
        return null;
      }

      if (!navigator.onLine) {
        writeLocalDraft(draftValue);
        setAutosaveState("offline");
        setMessage("Offline — this final comment is saved on this device.");
        return null;
      }

      setAutosaveState("saving");
      setMessage("Saving final comment…");

      const previousSave = inFlightRef.current;
      const saveOperation = (previousSave
        ? previousSave.catch(() => undefined)
        : Promise.resolve()
      ).then(() =>
        autosavePanelFeedbackDraft(
          applicationId,
          categoryId,
          draftValue,
          sourceGeneratedAtRef.current,
        ),
      );
      inFlightRef.current = saveOperation;

      void saveOperation
        .then((result) => {
          savedValueRef.current = draftValue;
          if (!mountedRef.current) return;

          if (latestValueRef.current === draftValue) {
            clearLocalDraft();
            setAutosaveState("saved");
            setMessage(
              `Autosaved ${new Date(result.savedAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
              })}`,
            );
          }
        })
        .catch((error) => {
          if (!mountedRef.current) return;
          writeLocalDraft(latestValueRef.current);
          setAutosaveState(navigator.onLine ? "error" : "offline");
          setMessage(
            navigator.onLine
              ? error instanceof Error
                ? `Autosave failed — saved on this device. ${error.message}`
                : "Autosave failed — this final comment is saved on this device."
              : "Offline — this final comment is saved on this device.",
          );
        })
        .finally(() => {
          if (inFlightRef.current === saveOperation) {
            inFlightRef.current = null;
          }
        });

      return saveOperation;
    },
    [applicationId, categoryId, clearLocalDraft, writeLocalDraft],
  );

  useEffect(() => {
    mountedRef.current = true;

    try {
      const rawDraft = window.localStorage.getItem(storageKey);
      if (rawDraft) {
        const draft = JSON.parse(rawDraft) as StoredPanelDraft;
        if (
          draft.applicationId === applicationId &&
          draft.categoryId === categoryId &&
          draft.reviewerId === currentUserId &&
          draft.value !== initialValue
        ) {
          latestValueRef.current = draft.value;
          sourceGeneratedAtRef.current = draft.sourceGeneratedAt ?? "";
          window.setTimeout(() => {
            if (!mountedRef.current) return;
            setValue(draft.value);
            setAutosaveState(navigator.onLine ? "pending" : "offline");
            setMessage(
              navigator.onLine
                ? "Restored a saved draft — autosave pending."
                : "Offline — restored the final comment saved on this device.",
            );
          }, 0);
        }
      }
    } catch {
      window.localStorage.removeItem(storageKey);
    }

    const syncWhenOnline = () => {
      const latestValue = latestValueRef.current;
      if (latestValue === savedValueRef.current) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(
        () => void queueSave(latestValue),
        150,
      );
    };
    const markOffline = () => {
      writeLocalDraft(latestValueRef.current);
      setAutosaveState("offline");
      setMessage("Offline — this final comment is saved on this device.");
    };

    window.addEventListener("online", syncWhenOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.removeEventListener("online", syncWhenOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, [
    applicationId,
    categoryId,
    currentUserId,
    initialValue,
    queueSave,
    storageKey,
    writeLocalDraft,
  ]);

  useEffect(() => {
    latestValueRef.current = value;
    if (value === savedValueRef.current) return;

    writeLocalDraft(value);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setAutosaveState(navigator.onLine ? "pending" : "offline");
    setMessage(
      navigator.onLine
        ? "Changes captured — autosave pending."
        : "Offline — this final comment is saved on this device.",
    );

    if (navigator.onLine && value.trim()) {
      timerRef.current = window.setTimeout(
        () => void queueSave(value),
        900,
      );
    }

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [queueSave, value, writeLocalDraft]);

  useEffect(() => {
    if (latestValueRef.current !== savedValueRef.current) return;
    savedValueRef.current = initialValue;
    latestValueRef.current = initialValue;
    sourceGeneratedAtRef.current = generatedAt;
    window.setTimeout(() => {
      if (mountedRef.current) setValue(initialValue);
    }, 0);
  }, [generatedAt, initialValue]);

  const approveComment = async () => {
    if (!value.trim() || approving) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setApproving(true);
    setMessage("Approving final comment…");

    try {
      if (inFlightRef.current) {
        await inFlightRef.current.catch(() => undefined);
      }
      const formData = new FormData();
      formData.set("final_comment", value);
      formData.set("approved", "on");
      formData.set("source_generated_at", sourceGeneratedAtRef.current);
      await savePanelFeedback(applicationId, categoryId, formData);
      clearLocalDraft();
      setAutosaveState("saved");
      setMessage("Approved and returned to the Owners.");
      router.refresh();
    } catch (error) {
      writeLocalDraft(value);
      setAutosaveState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The final comment could not be approved.",
      );
      setApproving(false);
    }
  };

  return (
    <div className="form-stack">
      <div className="field">
        <label htmlFor={`panel_final_comment_${categoryId}`}>
          Review and edit the assigned final comment
        </label>
        <textarea
          className="textarea narrative-textarea"
          disabled={approving}
          id={`panel_final_comment_${categoryId}`}
          onChange={(event) => setValue(event.target.value)}
          onInput={(event) => event.stopPropagation()}
          rows={8}
          value={value}
        />
      </div>
      <div
        aria-live="polite"
        className={`panel-narrative-autosave panel-narrative-autosave-${autosaveState}`}
        role="status"
      >
        <span aria-hidden="true" />
        {message}
      </div>
      <p className="field-help">
        Approval returns this category to the Owners and posts an update in the
        private panel channel.
      </p>
      <div className="button-row panel-narrative-actions">
        <button
          className="button button-dark"
          disabled={approving || !value.trim()}
          onClick={() => void approveComment()}
          type="button"
        >
          {approving ? "Approving…" : "Approve and return to Owners"}
        </button>
      </div>
    </div>
  );
}
