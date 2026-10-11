"use client";

import { useId, useMemo, useState } from "react";

import {
  calculateOverallProductionScore,
  OVERALL_PRODUCTION_CATEGORY_KEY,
} from "@/lib/adjudication-overall-score";
import {
  formatScore,
  formatScoreAverage,
  quarterScoreOptions,
} from "@/lib/adjudication";
import {
  calculateSandboxCategoryState,
  type SandboxCategoryDecision,
  type SandboxCriterionEntry,
} from "@/lib/adjudication-sandbox";
import type {
  AppRole,
  AwardCycle,
  ScoringCategory,
  ScoringCriterion,
  ScoringRubric,
  ScoringScaleLevel,
} from "@/lib/types";

type EntryMap = Record<string, SandboxCriterionEntry>;
type DecisionMap = Record<string, SandboxCategoryDecision>;

function initialEntries(criteria: ScoringCriterion[]): EntryMap {
  return Object.fromEntries(
    criteria.map((criterion) => [
      criterion.id,
      { score: null, comment: "" },
    ]),
  );
}

function defaultRangeMinimum(rubric: ScoringRubric) {
  return Math.min(
    rubric.score_max - 2,
    Math.max(rubric.score_min, rubric.score_max - 3),
  );
}

function initialDecisions({
  categories,
  rubric,
  canSetCommitteeDecision,
}: {
  categories: ScoringCategory[];
  rubric: ScoringRubric;
  canSetCommitteeDecision: boolean;
}): DecisionMap {
  return Object.fromEntries(
    categories.map((category) => [
      category.id,
      canSetCommitteeDecision
        ? { eligibility: "", rangeMinimum: null }
        : {
            eligibility: "yes",
            rangeMinimum: defaultRangeMinimum(rubric),
          },
    ]),
  );
}

function categoryCriteria(
  categoryId: string,
  criteria: ScoringCriterion[],
) {
  return criteria
    .filter((criterion) => criterion.category_id === categoryId)
    .sort((left, right) => left.sort_order - right.sort_order);
}

function rangeOptions(rubric: ScoringRubric) {
  const options: number[] = [];
  for (
    let minimum = rubric.score_min;
    minimum <= rubric.score_max - 2;
    minimum += 0.25
  ) {
    options.push(Number(minimum.toFixed(2)));
  }
  return options.reverse();
}

export function AdjudicationSandbox({
  categories,
  criteria,
  cycle,
  role,
  rubric,
  scale,
}: {
  categories: ScoringCategory[];
  criteria: ScoringCriterion[];
  cycle: AwardCycle | null;
  role: AppRole;
  rubric: ScoringRubric;
  scale: ScoringScaleLevel[];
}) {
  const reactId = useId().replaceAll(":", "");
  const scoreableCategories = useMemo(
    () =>
      categories
        .filter(
          (category) =>
            category.category_key !== OVERALL_PRODUCTION_CATEGORY_KEY,
        )
        .sort((left, right) => left.sort_order - right.sort_order),
    [categories],
  );
  const canSetCommitteeDecision =
    role === "advisory_member" || role === "owner";
  const [activeCategoryId, setActiveCategoryId] = useState(
    scoreableCategories[0]?.id ?? "",
  );
  const [entries, setEntries] = useState<EntryMap>(() =>
    initialEntries(criteria),
  );
  const [decisions, setDecisions] = useState<DecisionMap>(() =>
    initialDecisions({ categories, rubric, canSetCommitteeDecision }),
  );
  const [reviewOpen, setReviewOpen] = useState(false);

  const activeCategory =
    scoreableCategories.find(
      (category) => category.id === activeCategoryId,
    ) ?? scoreableCategories[0];
  const activeCriteria = activeCategory
    ? categoryCriteria(activeCategory.id, criteria)
    : [];
  const activeDecision = activeCategory
    ? decisions[activeCategory.id]
    : undefined;
  const activeState =
    activeCategory && activeDecision
      ? calculateSandboxCategoryState({
          criterionIds: activeCriteria.map((criterion) => criterion.id),
          entries,
          decision: activeDecision,
        })
      : null;
  const categoryStates = Object.fromEntries(
    scoreableCategories.map((category) => {
      const ids = categoryCriteria(category.id, criteria).map(
        (criterion) => criterion.id,
      );
      return [
        category.id,
        calculateSandboxCategoryState({
          criterionIds: ids,
          entries,
          decision: decisions[category.id],
        }),
      ];
    }),
  );
  const completeCount = Object.values(categoryStates).filter(
    (state) => state.complete,
  ).length;
  const overall = calculateOverallProductionScore({
    categories,
    criteria,
    scores: new Map(
      Object.entries(entries).map(([criterionId, entry]) => [
        criterionId,
        entry.score,
      ]),
    ),
  });
  const scaleByScore = new Map(scale.map((level) => [level.score, level]));
  const activeIndex = activeCategory
    ? scoreableCategories.findIndex(
        (category) => category.id === activeCategory.id,
      )
    : -1;

  function resetSandbox() {
    setEntries(initialEntries(criteria));
    setDecisions(
      initialDecisions({ categories, rubric, canSetCommitteeDecision }),
    );
    setActiveCategoryId(scoreableCategories[0]?.id ?? "");
    setReviewOpen(false);
  }

  function moveCategory(direction: -1 | 1) {
    if (activeIndex < 0) return;
    const nextIndex = Math.min(
      scoreableCategories.length - 1,
      Math.max(0, activeIndex + direction),
    );
    setActiveCategoryId(scoreableCategories[nextIndex]?.id ?? "");
  }

  if (!activeCategory || scoreableCategories.length === 0) {
    return (
      <section className="panel empty-state">
        <h2>No scoreable categories are available.</h2>
        <p>Add active categories and criteria to the published rubric.</p>
      </section>
    );
  }

  return (
    <div className="adjudication-sandbox">
      <section className="sandbox-safety-notice" aria-label="Practice notice">
        <div className="sandbox-safety-icon" aria-hidden="true">
          ◇
        </div>
        <div>
          <strong>PRACTICE ONLY — NOTHING HERE IS SAVED</strong>
          <p>
            This sandbox is not connected to a school, production, assignment,
            or scorecard. Refreshing or leaving the page clears every entry.
          </p>
        </div>
        <button
          className="button button-secondary button-compact"
          onClick={resetSandbox}
          type="button"
        >
          Reset practice
        </button>
      </section>

      <section className="sandbox-overview-grid" aria-label="Sandbox summary">
        <article className="sandbox-overview-card">
          <span>Current rubric</span>
          <strong>{rubric.name}</strong>
          <small>
            {cycle?.name ?? "Current program"} · Version {rubric.version_number}
          </small>
        </article>
        <article className="sandbox-overview-card">
          <span>Practice production</span>
          <strong>Sandbox Musical</strong>
          <small>No real school or student data</small>
        </article>
        <article className="sandbox-overview-card">
          <span>Category progress</span>
          <strong>
            {completeCount} / {scoreableCategories.length}
          </strong>
          <small>Turns complete when all practice requirements pass</small>
        </article>
        <article className="sandbox-overview-card">
          <span>Your live overall average</span>
          <strong>{formatScoreAverage(overall.score)}</strong>
          <small>
            {overall.completedCategoryCount} of {overall.scoreableCategoryCount}{" "}
            categories fully scored
          </small>
        </article>
      </section>

      <section className="panel sandbox-category-navigator">
        <button
          aria-label="Previous category"
          className="sandbox-category-arrow"
          disabled={activeIndex <= 0}
          onClick={() => moveCategory(-1)}
          type="button"
        >
          ←
        </button>
        <div className="field">
          <label htmlFor={`sandbox-category-${reactId}`}>JUMP TO CATEGORY</label>
          <select
            className={`select sandbox-category-select ${activeState?.complete ? "is-complete" : ""}`}
            id={`sandbox-category-${reactId}`}
            onChange={(event) => setActiveCategoryId(event.target.value)}
            value={activeCategory.id}
          >
            {scoreableCategories.map((category, index) => (
              <option key={category.id} value={category.id}>
                {categoryStates[category.id]?.complete ? "✓ " : ""}
                {index + 1}. {category.title}
              </option>
            ))}
          </select>
        </div>
        <button
          aria-label="Next category"
          className="sandbox-category-arrow"
          disabled={activeIndex >= scoreableCategories.length - 1}
          onClick={() => moveCategory(1)}
          type="button"
        >
          →
        </button>
        <button
          className="button button-secondary sandbox-review-button"
          onClick={() => setReviewOpen(true)}
          type="button"
        >
          Review all categories
        </button>
      </section>

      <section className="panel sandbox-committee-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Committee decision practice</span>
            <h2>{activeCategory.title}</h2>
            <p>
              {canSetCommitteeDecision
                ? "Practice setting eligibility and the required two-point scoring range."
                : "This sample decision mirrors what the Committee releases to an adjudicator."}
            </p>
          </div>
          <span className="badge">
            {canSetCommitteeDecision ? "Editable practice" : "Sample decision"}
          </span>
        </div>
        <div className="sandbox-committee-fields">
          <div className="field">
            <label htmlFor={`sandbox-eligibility-${reactId}`}>
              CATEGORY ELIGIBILITY
            </label>
            <select
              className="select"
              disabled={!canSetCommitteeDecision}
              id={`sandbox-eligibility-${reactId}`}
              onChange={(event) =>
                setDecisions((current) => ({
                  ...current,
                  [activeCategory.id]: {
                    ...current[activeCategory.id],
                    eligibility: event.target.value as "" | "yes" | "no",
                  },
                }))
              }
              value={activeDecision?.eligibility ?? ""}
            >
              <option value="">Choose Yes or No</option>
              <option value="yes">YES</option>
              <option value="no">NO</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`sandbox-range-${reactId}`}>
              REQUIRED TWO-POINT RANGE
            </label>
            <select
              className="select"
              disabled={!canSetCommitteeDecision}
              id={`sandbox-range-${reactId}`}
              onChange={(event) =>
                setDecisions((current) => ({
                  ...current,
                  [activeCategory.id]: {
                    ...current[activeCategory.id],
                    rangeMinimum: event.target.value
                      ? Number(event.target.value)
                      : null,
                  },
                }))
              }
              value={activeDecision?.rangeMinimum ?? ""}
            >
              <option value="">Choose a range</option>
              {rangeOptions(rubric).map((minimum) => (
                <option key={minimum} value={minimum}>
                  {formatScore(minimum)}–{formatScore(minimum + 2)}
                </option>
              ))}
            </select>
          </div>
          <div
            className={`sandbox-range-status ${
              activeState?.withinRange === false
                ? "is-outside"
                : activeState?.withinRange === true
                  ? "is-inside"
                  : ""
            }`}
          >
            <span>Your category average</span>
            <strong>{formatScoreAverage(activeState?.average)}</strong>
            <small>
              {activeState?.withinRange == null
                ? "Enter all scores and select a range to check it."
                : activeState.withinRange
                  ? "Inside the required two-point range"
                  : "Outside the required two-point range"}
            </small>
          </div>
        </div>
      </section>

      <section className="panel sandbox-scoring-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Scoring practice</span>
            <h2>{activeCategory.title}</h2>
            <p>
              Score every criterion and enter one specific practice observation
              for each.
            </p>
          </div>
          <span
            className={`badge ${activeState?.complete ? "badge-complete" : "badge-warning"}`}
          >
            {activeState?.complete ? "Category complete" : "Practice in progress"}
          </span>
        </div>

        <div className="sandbox-criterion-list">
          {activeCriteria.map((criterion, index) => {
            const entry = entries[criterion.id] ?? {
              score: null,
              comment: "",
            };
            return (
              <article className="sandbox-criterion-card" key={criterion.id}>
                <div className="sandbox-criterion-copy">
                  <span className="section-order">Criterion {index + 1}</span>
                  <h3>{criterion.title}</h3>
                  {criterion.description ? (
                    <p>{criterion.description}</p>
                  ) : null}
                </div>
                <div className="sandbox-criterion-entry">
                  <div className="field">
                    <label htmlFor={`sandbox-score-${criterion.id}`}>
                      YOUR SCORE
                    </label>
                    <select
                      className="select"
                      id={`sandbox-score-${criterion.id}`}
                      onChange={(event) =>
                        setEntries((current) => ({
                          ...current,
                          [criterion.id]: {
                            ...current[criterion.id],
                            score: event.target.value
                              ? Number(event.target.value)
                              : null,
                          },
                        }))
                      }
                      value={entry.score ?? ""}
                    >
                      <option value="">Choose a score</option>
                      {quarterScoreOptions(
                        rubric.score_min,
                        rubric.score_max,
                      ).map((scoreValue) => {
                        const level = scaleByScore.get(scoreValue);
                        return (
                          <option key={scoreValue} value={scoreValue}>
                            {scoreValue.toFixed(2)}
                            {level ? ` — ${level.label}` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`sandbox-comment-${criterion.id}`}>
                      PRACTICE OBSERVATION
                    </label>
                    <textarea
                      className="textarea"
                      id={`sandbox-comment-${criterion.id}`}
                      onChange={(event) =>
                        setEntries((current) => ({
                          ...current,
                          [criterion.id]: {
                            ...current[criterion.id],
                            comment: event.target.value,
                          },
                        }))
                      }
                      placeholder="Describe what you observed and connect it to this criterion."
                      value={entry.comment}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {reviewOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReviewOpen(false);
          }}
          role="presentation"
        >
          <section
            aria-labelledby={`sandbox-review-${reactId}`}
            aria-modal="true"
            className="modal-card sandbox-review-modal"
            role="dialog"
          >
            <header className="modal-header">
              <div>
                <span className="eyebrow">Practice progress</span>
                <h2 id={`sandbox-review-${reactId}`}>REVIEW ALL CATEGORIES</h2>
                <p>
                  This review is a preview only. It cannot submit or change a
                  live scorecard.
                </p>
              </div>
              <button
                aria-label="Close category review"
                className="modal-close"
                onClick={() => setReviewOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="sandbox-review-list">
              {scoreableCategories.map((category, index) => {
                const state = categoryStates[category.id];
                const decision = decisions[category.id];
                return (
                  <button
                    className="sandbox-review-row"
                    key={category.id}
                    onClick={() => {
                      setActiveCategoryId(category.id);
                      setReviewOpen(false);
                    }}
                    type="button"
                  >
                    <span>
                      <strong>
                        {index + 1}. {category.title}
                      </strong>
                      <small>
                        Eligibility: {decision.eligibility || "Not selected"} ·
                        Range:{" "}
                        {decision.rangeMinimum == null
                          ? "Not selected"
                          : `${formatScore(decision.rangeMinimum)}–${formatScore(decision.rangeMinimum + 2)}`}
                      </small>
                    </span>
                    <span>
                      <strong>{formatScoreAverage(state.average)}</strong>
                      <small className={state.complete ? "is-complete" : ""}>
                        {state.complete ? "Complete" : "Needs practice"}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
            <footer className="modal-actions">
              <button
                className="button button-secondary"
                onClick={() => setReviewOpen(false)}
                type="button"
              >
                Return to practice
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
