"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { saveAdjudicatorScorecard } from "@/app/portal/adjudication/[id]/actions";
import { richTextHasContent } from "@/lib/rich-text";
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
): CompletionState {
  const formData = new FormData(form);
  let missingCount = 0;

  for (const category of categories) {
    const notApplicable =
      category.allow_not_applicable &&
      formData.get(`not_applicable_${category.id}`) === "on";

    if (notApplicable) {
      if (!formText(formData, `not_applicable_reason_${category.id}`)) {
        missingCount += 1;
      }
      continue;
    }

    if (
      category.subject_label &&
      !formText(formData, `subject_name_${category.id}`)
    ) {
      missingCount += 1;
    }

    for (const criterion of criteria.filter(
      (item) => item.category_id === category.id,
    )) {
      if (!formText(formData, `score_${criterion.id}`)) {
        missingCount += 1;
      }

      if (
        !richTextHasContent(
          formText(formData, `observation_${criterion.id}`),
        )
      ) {
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
  criteria,
}: {
  applicationId: string;
  categories: ScoringCategory[];
  criteria: ScoringCriterion[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [completion, setCompletion] = useState<CompletionState>({
    complete: false,
    missingCount: 0,
  });

  const updateCompletion = useCallback(() => {
    const form = hostRef.current?.closest("form");
    if (!form) return;
    setCompletion(evaluateCompletion(form, categories, criteria));
  }, [categories, criteria]);

  useEffect(() => {
    const form = hostRef.current?.closest("form");
    if (!form) return;

    const scheduleUpdate = () => {
      window.setTimeout(updateCompletion, 0);
    };

    updateCompletion();
    form.addEventListener("input", scheduleUpdate);
    form.addEventListener("change", scheduleUpdate);

    return () => {
      form.removeEventListener("input", scheduleUpdate);
      form.removeEventListener("change", scheduleUpdate);
    };
  }, [updateCompletion]);

  return (
    <div className="scorecard-submit-control" ref={hostRef}>
      <button
        className="button button-dark"
        disabled={!completion.complete}
        formAction={saveAdjudicatorScorecard.bind(
          null,
          applicationId,
          true,
        )}
        type="submit"
      >
        Submit scorecard
      </button>

      <small aria-live="polite" className="scorecard-submit-help">
        {completion.complete
          ? "All required fields are complete."
          : `${completion.missingCount} required field${
              completion.missingCount === 1 ? "" : "s"
            } remaining.`}
      </small>
    </div>
  );
}
