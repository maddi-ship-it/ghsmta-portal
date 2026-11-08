"use client";

import { useEffect, useState, useTransition } from "react";

import {
  saveFullScoreCategoryRanges,
  type FullScoreRangeSaveResult,
} from "@/app/portal/adjudication/[id]/workflow-actions";
import {
  ADJUDICATION_RANGE_SELECTION_EVENT,
  announceAdjudicationRangeSelection,
  type AdjudicationRangeSelectionDetail,
} from "@/lib/adjudication-range-sync";
import {
  formatTwoPointRangeStart,
  TWO_POINT_RANGE_START_OPTIONS,
} from "@/lib/adjudication-ranges";

const initialSaveResult: FullScoreRangeSaveResult = { ok: false };

export function AdvisoryCategoryRangeControl({
  applicationId,
  categoryId,
  categoryTitle,
  initialRangeStart,
  isEligible,
}: {
  applicationId: string;
  categoryId: string;
  categoryTitle: string;
  initialRangeStart: number | string | null | undefined;
  isEligible: boolean;
}) {
  const [rangeStart, setRangeStart] = useState(() =>
    formatTwoPointRangeStart(initialRangeStart),
  );
  const [saveResult, setSaveResult] =
    useState<FullScoreRangeSaveResult>(initialSaveResult);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const syncRangeSelection = (event: Event) => {
      const detail = (
        event as CustomEvent<AdjudicationRangeSelectionDetail>
      ).detail;
      if (
        !detail ||
        detail.applicationId !== applicationId ||
        detail.categoryId !== categoryId
      ) {
        return;
      }

      setRangeStart(detail.rangeStart);
      setSaveResult(initialSaveResult);
    };

    window.addEventListener(
      ADJUDICATION_RANGE_SELECTION_EVENT,
      syncRangeSelection,
    );
    return () => {
      window.removeEventListener(
        ADJUDICATION_RANGE_SELECTION_EVENT,
        syncRangeSelection,
      );
    };
  }, [applicationId, categoryId]);

  const saveRange = () => {
    const selectedRangeStart = rangeStart;
    const formData = new FormData();
    formData.set("range_category_id", categoryId);
    formData.set(`full_score_range_${categoryId}`, selectedRangeStart);
    setSaveResult(initialSaveResult);

    startTransition(async () => {
      const result = await saveFullScoreCategoryRanges(
        applicationId,
        { [categoryId]: isEligible },
        initialSaveResult,
        formData,
      );
      setSaveResult(result);
    });
  };

  return (
    <section
      aria-labelledby={`inline-range-title-${categoryId}`}
      className="panel-body advisory-inline-range-control"
    >
      <div className="advisory-inline-range-copy">
        <span className="eyebrow">ACM range</span>
        <h3 id={`inline-range-title-${categoryId}`}>
          Two-point range for {categoryTitle}
        </h3>
        <p>
          Enter the range manually. This selection is linked with Review all
          categories and the full-score view.
        </p>
      </div>

      <div className="advisory-inline-range-actions">
        <label className="sr-only" htmlFor={`inline-range-${categoryId}`}>
          Two-point range for {categoryTitle}
        </label>
        <select
          className="select"
          id={`inline-range-${categoryId}`}
          onChange={(event) => {
            const nextRangeStart = event.target.value;
            setRangeStart(nextRangeStart);
            setSaveResult(initialSaveResult);
            announceAdjudicationRangeSelection({
              applicationId,
              categoryId,
              rangeStart: nextRangeStart,
            });
          }}
          value={rangeStart}
        >
          <option value="">Not set</option>
          {TWO_POINT_RANGE_START_OPTIONS.map((value) => (
            <option key={value} value={value.toFixed(2)}>
              {value.toFixed(2)}–{(value + 2).toFixed(2)}
            </option>
          ))}
        </select>
        <button
          className="button button-gold button-compact"
          disabled={isPending}
          onClick={saveRange}
          type="button"
        >
          {isPending ? "Saving…" : "Save range"}
        </button>
      </div>

      {saveResult.message ? (
        <small aria-live="polite" className="advisory-inline-range-message">
          {saveResult.message}
        </small>
      ) : null}
      {saveResult.error ? (
        <small className="form-error" role="alert">
          {saveResult.error}
        </small>
      ) : null}
    </section>
  );
}
