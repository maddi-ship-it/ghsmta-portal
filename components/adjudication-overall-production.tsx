"use client";

import { useEffect, useMemo, useState } from "react";

import { RichTextField } from "@/components/rich-text-field";
import {
  calculateOverallProductionScore,
  OVERALL_PRODUCTION_CATEGORY_KEY,
} from "@/lib/adjudication-overall-score";
import {
  ADJUDICATION_SCORE_CHANGE_EVENT,
  type AdjudicationScoreChangeDetail,
} from "@/lib/adjudication-score-events";
import { roundScoreAverage } from "@/lib/adjudication";
import {
  richTextHasContent,
  sanitizeRichTextHtml,
} from "@/lib/rich-text";
import type {
  AdjudicationScore,
  ScoringCategory,
  ScoringCriterion,
} from "@/lib/types";

function formatAverage(value: number | null) {
  const rounded = roundScoreAverage(value);
  return rounded == null ? "—" : rounded.toFixed(5);
}

export function AdjudicationOverallProduction({
  categories,
  criteria,
  ownScores,
}: {
  categories: ScoringCategory[];
  criteria: ScoringCriterion[];
  ownScores: AdjudicationScore[];
}) {
  const [scoreValues, setScoreValues] = useState<Record<string, number | null>>(
    () =>
      Object.fromEntries(
        ownScores.map((score) => [score.criterion_id, score.score]),
      ),
  );

  useEffect(() => {
    const updateScore = (event: Event) => {
      const detail = (
        event as CustomEvent<AdjudicationScoreChangeDetail>
      ).detail;

      if (!detail?.criterionId) return;

      setScoreValues((current) => ({
        ...current,
        [detail.criterionId]: detail.value,
      }));
    };

    window.addEventListener(ADJUDICATION_SCORE_CHANGE_EVENT, updateScore);

    return () => {
      window.removeEventListener(ADJUDICATION_SCORE_CHANGE_EVENT, updateScore);
    };
  }, []);

  const overallCategory = categories.find(
    (category) =>
      category.category_key === OVERALL_PRODUCTION_CATEGORY_KEY,
  );
  const overallCriterion = criteria.find(
    (criterion) => criterion.category_id === overallCategory?.id,
  );
  const overall = useMemo(
    () =>
      calculateOverallProductionScore({
        categories,
        criteria,
        scores: new Map(Object.entries(scoreValues)),
      }),
    [categories, criteria, scoreValues],
  );

  if (!overallCategory || !overallCriterion) return null;

  return (
    <section className="panel overall-production-summary">
      <div className="overall-production-score">
        <div>
          <span className="eyebrow">Overall Production</span>
          <h2>Your live overall average</h2>
          <p>
            Automatically calculated from each applicable category. This
            score cannot be edited and has no two-point range.
          </p>
        </div>
        <div className="overall-production-score-value">
          <output aria-label="Automatically calculated overall production score">
            {formatAverage(overall.score)}
          </output>
          <small>
            {overall.completedCategoryCount} of {overall.scoreableCategoryCount}{" "}
            applicable categories complete
          </small>
        </div>
      </div>

    </section>
  );
}

export function AdjudicationBigPictureComment({
  categories,
  criteria,
  ownScores,
  privateNotes,
  canComment,
  readOnly,
}: {
  categories: ScoringCategory[];
  criteria: ScoringCriterion[];
  ownScores: AdjudicationScore[];
  privateNotes: string | null | undefined;
  canComment: boolean;
  readOnly: boolean;
}) {
  const overallCategory = categories.find(
    (category) =>
      category.category_key === OVERALL_PRODUCTION_CATEGORY_KEY,
  );
  const overallCriterion = criteria.find(
    (criterion) => criterion.category_id === overallCategory?.id,
  );
  const savedBigPicture = ownScores.find(
    (score) => score.criterion_id === overallCriterion?.id,
  )?.observation;

  if (!overallCategory || !overallCriterion) return null;

  return (
    <section className="panel big-picture-comment-panel">
      <input
        defaultValue={privateNotes ?? ""}
        name={`private_notes_${overallCategory.id}`}
        type="hidden"
      />
      <div className="overall-production-big-picture">
        <div>
          <span className="section-order">Production-wide notes</span>
          <h3>Big Picture comment</h3>
          <p>
            Capture the most important observation about the production as a
            whole. This comment autosaves with the rest of your scorecard.
          </p>
        </div>
        {canComment ? (
          <RichTextField
            defaultValue={savedBigPicture}
            disabled={readOnly}
            id={`observation_${overallCriterion.id}`}
            label="Your Big Picture comment"
            name={`observation_${overallCriterion.id}`}
            placeholder="Enter your production-wide observation"
          />
        ) : (
          <div className="comment-readonly-surface">
            {richTextHasContent(savedBigPicture) ? (
              <div
                className="rich-text-preview"
                dangerouslySetInnerHTML={{
                  __html: sanitizeRichTextHtml(savedBigPicture),
                }}
              />
            ) : (
              "No Big Picture comment was entered before commenting was disabled."
            )}
          </div>
        )}
      </div>
    </section>
  );
}
