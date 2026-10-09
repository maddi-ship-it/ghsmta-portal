"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { saveAdjudicatorScorecard } from "@/app/portal/adjudication/[id]/actions";
import { offlineScorecardDraftKey } from "@/components/adjudicator-autosave";
import { richTextHasContent } from "@/lib/rich-text";
import { OVERALL_PRODUCTION_CATEGORY_KEY } from "@/lib/adjudication-overall-score";
import type { ScoringCategory, ScoringCriterion } from "@/lib/types";

type CompletionState = {
  complete: boolean;
  missingCount: number;
};

function formText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function evaluateCompletion(
  form: HTMLFormElement,
  categories: ScoringCategory[],
  criteria: ScoringCriterion[],
  requireComments: boolean,
): CompletionState {
  const formData = new FormData(form);
  let missingCount = 0;

  for (const category of categories) {
    const isOverallProduction =
      category.category_key === OVERALL_PRODUCTION_CATEGORY_KEY;

    if (
      !isOverallProduction &&
      !formText(formData, `score_range_start_${category.id}`)
    ) {
      missingCount += 1;
    }

    if (
      !isOverallProduction &&
      formData.get(`category_decision_finalized_${category.id}`) !== "1"
    ) {
      missingCount += 1;
    }

    if (
      category.subject_label &&
      !formText(formData, `subject_name_${category.id}`)
    ) {
      missingCount += 1;
    }

    const categoryScores: number[] = [];
    const categoryCriteria = criteria.filter(
      (item) => item.category_id === category.id,
    );

    for (const criterion of categoryCriteria) {
      const rawScore = formText(formData, `score_${criterion.id}`);

      if (!isOverallProduction && !rawScore) {
        missingCount += 1;
      } else if (!isOverallProduction) {
        const numericScore = Number(rawScore);
        if (Number.isFinite(numericScore)) {
          categoryScores.push(numericScore);
        }
      }

      if (
        requireComments &&
        !richTextHasContent(
          formText(formData, `observation_${criterion.id}`),
        )
      ) {
        missingCount += 1;
      }
    }

    const rawRangeStart = formText(
      formData,
      `score_range_start_${category.id}`,
    );
    const rangeStart = rawRangeStart ? Number(rawRangeStart) : null;

    if (
      !isOverallProduction &&
      rangeStart != null &&
      categoryScores.length === categoryCriteria.length &&
      categoryCriteria.length > 0
    ) {
      const average =
        categoryScores.reduce((sum, score) => sum + score, 0) /
        categoryScores.length;
      const rangeEnd = rangeStart + 2;

      if (average < rangeStart - 0.0001 || average > rangeEnd + 0.0001) {
        missingCount += 1;
      }
    }
  }

  return {
    complete: missingCount === 0,
    missingCount,
  };
}

export function ScorecardSubmitControls({
  applicationId,
  categories,
  compact = false,
  criteria,
  formId,
  requireComments = true,
}: {
  applicationId: string;
  categories: ScoringCategory[];
  compact?: boolean;
  criteria: ScoringCriterion[];
  formId?: string;
  requireComments?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [completion, setCompletion] = useState<CompletionState>({
    complete: false,
    missingCount: 0,
  });
  const [online, setOnline] = useState(true);
  const [hasOfflineDraft, setHasOfflineDraft] = useState(false);

  const findForm = useCallback(() => {
    if (formId) {
      const form = document.getElementById(formId);
      return form instanceof HTMLFormElement ? form : null;
    }

    return hostRef.current?.closest("form") ?? null;
  }, [formId]);

  const updateCompletion = useCallback(() => {
    const form = findForm();
    if (!form) return;
    setCompletion(evaluateCompletion(form, categories, criteria, requireComments));
  }, [categories, criteria, findForm, requireComments]);

  useEffect(() => {
    const form = findForm();
    if (!form) return;

    let updateTimer: number | undefined;
    const scheduleUpdate = () => {
      if (updateTimer) window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(updateCompletion, 0);
    };

    scheduleUpdate();
    form.addEventListener("input", scheduleUpdate);
    form.addEventListener("change", scheduleUpdate);

    return () => {
      if (updateTimer) window.clearTimeout(updateTimer);
      form.removeEventListener("input", scheduleUpdate);
      form.removeEventListener("change", scheduleUpdate);
    };
  }, [findForm, updateCompletion]);

  useEffect(() => {
    const updateSyncState = () => {
      setOnline(navigator.onLine);
      setHasOfflineDraft(
        Boolean(window.localStorage.getItem(offlineScorecardDraftKey(applicationId))),
      );
    };

    const handleDraftChange = (event: Event) => {
      const detail = (event as CustomEvent<{ applicationId?: string; hasDraft?: boolean }>).detail;
      if (detail?.applicationId !== applicationId) return;
      setHasOfflineDraft(Boolean(detail.hasDraft));
      setOnline(navigator.onLine);
    };

    updateSyncState();
    window.addEventListener("online", updateSyncState);
    window.addEventListener("offline", updateSyncState);
    window.addEventListener("storage", updateSyncState);
    window.addEventListener("ghsmta:offline-scorecard-draft-changed", handleDraftChange);

    return () => {
      window.removeEventListener("online", updateSyncState);
      window.removeEventListener("offline", updateSyncState);
      window.removeEventListener("storage", updateSyncState);
      window.removeEventListener("ghsmta:offline-scorecard-draft-changed", handleDraftChange);
    };
  }, [applicationId]);

  const blockedBySync = !online || hasOfflineDraft;
  const canSubmit = completion.complete && !blockedBySync;
  const helpMessage = !online
    ? "Final submission is available once you are back online."
    : hasOfflineDraft
      ? "Final submission unlocks after the saved scorecard finishes syncing."
      : completion.complete
        ? "All required fields are complete."
        : `${completion.missingCount} required field${
            completion.missingCount === 1 ? "" : "s"
          } remaining.`;
  const helpId = `scorecard-submit-help-${applicationId}`;

  return (
    <div
      className={`scorecard-submit-control${
        compact ? " scorecard-submit-control-compact" : ""
      }`}
      ref={hostRef}
    >
      <button
        aria-describedby={helpId}
        className={
          compact
            ? "application-reference-button application-reference-submit-button"
            : "button button-dark"
        }
        disabled={!canSubmit}
        form={formId}
        formAction={saveAdjudicatorScorecard.bind(
          null,
          applicationId,
          true,
        )}
        title={compact ? helpMessage : undefined}
        type="submit"
      >
        Submit scorecard
      </button>

      <small
        aria-live="polite"
        className={`scorecard-submit-help${
          compact ? " scorecard-submit-help-compact" : ""
        }`}
        id={helpId}
      >
        {helpMessage}
      </small>
    </div>
  );
}
