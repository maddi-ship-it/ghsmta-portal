"use client";

import { useState } from "react";

import {
  APPLY_ADJUDICATION_BRAIN_DUMP_EVENT,
  type AdjudicationBrainDumpAssignment,
} from "@/lib/adjudication-brain-dump";

type SortResponse = {
  assignments?: AdjudicationBrainDumpAssignment[];
  unmatched?: string[];
  error?: string;
};

export function AdjudicationBrainDump({
  applicationId,
  defaultValue,
  canComment,
  readOnly,
}: {
  applicationId: string;
  defaultValue: string | null | undefined;
  canComment: boolean;
  readOnly: boolean;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [expanded, setExpanded] = useState(!(defaultValue ?? "").trim());
  const [sorting, setSorting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sortNotes = async () => {
    const notes = value.trim();
    if (!notes || sorting || readOnly || !canComment) return;

    setSorting(true);
    setMessage("Sorting notes into the matching criteria…");

    try {
      const response = await fetch("/api/writing-assist/adjudication-sort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, notes }),
      });
      const payload = (await response.json().catch(() => null)) as
        | SortResponse
        | null;

      if (!response.ok) {
        throw new Error(payload?.error || "The notes could not be sorted.");
      }

      const assignments = payload?.assignments ?? [];
      if (assignments.length === 0) {
        setMessage(
          "No notes could be confidently matched. Your original brain dump is unchanged.",
        );
        return;
      }

      window.dispatchEvent(
        new CustomEvent(APPLY_ADJUDICATION_BRAIN_DUMP_EVENT, {
          detail: { assignments },
        }),
      );

      const unmatchedCount = payload?.unmatched?.length ?? 0;
      setMessage(
        `${assignments.length} criterion comment${
          assignments.length === 1 ? " was" : "s were"
        } updated. Review the sorted comments before submitting.${
          unmatchedCount > 0
            ? ` ${unmatchedCount} note${unmatchedCount === 1 ? " was" : "s were"} left only in the brain dump.`
            : ""
        }`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The notes could not be sorted.",
      );
    } finally {
      setSorting(false);
    }
  };

  return (
    <details
      className="panel adjudication-brain-dump"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      open={expanded}
    >
      <summary className="adjudication-brain-dump-summary">
        <span>
          <span className="eyebrow">Private working notes</span>
          <strong>Initial brain dump</strong>
        </span>
        <span className="adjudication-brain-dump-summary-hint">
          Expand / collapse
        </span>
      </summary>

      <div className="panel-body adjudication-brain-dump-body">
        <div className="field">
          <label htmlFor={canComment ? "scorecard_internal_notes" : undefined}>
            Dictate, scan, paste, or type everything you noticed
          </label>
          {canComment ? (
            <textarea
              className="textarea adjudication-brain-dump-input"
              disabled={readOnly}
              id="scorecard_internal_notes"
              maxLength={30000}
              name="scorecard_internal_notes"
              onChange={(event) => {
                setValue(event.target.value);
                setMessage(null);
              }}
              placeholder="Capture your unsorted observations here. Focus this box to use Dictate or Scan notes."
              value={value}
            />
          ) : (
            <div className="comment-readonly-surface">
              {value ||
                "No private notes were entered before commenting was disabled."}
            </div>
          )}
          <small className="field-help">
            These private notes autosave with your scorecard. Auto-sort adds
            matched text to criterion comments; it never assigns scores or
            removes the original brain dump.
          </small>
        </div>

        {canComment && !readOnly && (
          <div className="adjudication-brain-dump-actions">
            <button
              className="button button-gold"
              disabled={!value.trim() || sorting}
              onClick={() => void sortNotes()}
              type="button"
            >
              {sorting ? "Sorting…" : "Auto-sort by category & criterion"}
            </button>
            <small>Review every suggested placement before submission.</small>
          </div>
        )}

        {message && (
          <div aria-live="polite" className="notice adjudication-brain-dump-message">
            {message}
          </div>
        )}
      </div>
    </details>
  );
}
