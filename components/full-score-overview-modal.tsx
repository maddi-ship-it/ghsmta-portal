"use client";

import { useActionState, useEffect, useMemo } from "react";

import {
  saveFullScoreCategoryRanges,
  type FullScoreRangeSaveResult,
} from "@/app/portal/adjudication/[id]/workflow-actions";
import { ScheduleSubmitButton } from "@/components/schedule-submit-button";
import {
  average as scoreAverage,
  formatScoreAverage,
} from "@/lib/adjudication";
import {
  calculateOverallProductionScore,
  OVERALL_PRODUCTION_CATEGORY_KEY,
} from "@/lib/adjudication-overall-score";
import {
  deriveNaturalTwoPointRange,
  formatTwoPointRangeStart,
} from "@/lib/adjudication-ranges";
import { resolvePanelAveragePolicy } from "@/lib/panel-average-policy";
import type {
  AdjudicationScore,
  AdjudicationScorecard,
  AdjudicatorAssignment,
  Profile,
  ScoringCategory,
  ScoringCriterion,
} from "@/lib/types";

type PanelMemberScore = {
  assignment: AdjudicatorAssignment;
  name: string;
  scorecard: AdjudicationScorecard | null;
  scoreByCriterion: Map<string, number | null>;
  overallAverage: number | null;
  completedCategoryCount: number;
  scoreableCategoryCount: number;
  contributesToPanelAverage: boolean;
};

export type FullScoreCategoryProposal = {
  category_id: string;
  is_eligible: boolean;
  range_min: number | null;
  range_max: number | null;
  status: string;
  advisory_note: string | null;
  owner_override_note: string | null;
};

const rangeOptions = Array.from(
  { length: 29 },
  (_, index) => 1 + index * 0.25,
).filter((value) => value <= 8);

const initialRangeSaveResult: FullScoreRangeSaveResult = { ok: false };

function categoryAverage(
  category: ScoringCategory,
  categoryCriteria: ScoringCriterion[],
  member: PanelMemberScore,
) {
  if (category.category_key === OVERALL_PRODUCTION_CATEGORY_KEY) {
    return member.overallAverage;
  }

  return scoreAverage(
    categoryCriteria.flatMap((criterion) => {
      const score = member.scoreByCriterion.get(criterion.id);
      return score == null || !Number.isFinite(score) ? [] : [score];
    }),
  );
}

export function FullScoreOverviewModal({
  applicationId,
  assignments,
  categories,
  categoryProposals,
  criteria,
  onClose,
  open,
  profiles,
  scorecards,
  scores,
}: {
  applicationId: string;
  assignments: AdjudicatorAssignment[];
  categories: ScoringCategory[];
  categoryProposals: FullScoreCategoryProposal[];
  criteria: ScoringCriterion[];
  onClose: () => void;
  open: boolean;
  profiles: Profile[];
  scorecards: AdjudicationScorecard[];
  scores: AdjudicationScore[];
}) {
  const saveRangeAction = useMemo(
    () => saveFullScoreCategoryRanges.bind(null, applicationId),
    [applicationId],
  );
  const [rangeSaveResult, saveRanges] = useActionState(
    saveRangeAction,
    initialRangeSaveResult,
  );
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, open]);

  const panelMembers = useMemo(() => {
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const scorecardByAssignmentId = new Map(
      scorecards.map((scorecard) => [scorecard.assignment_id, scorecard]),
    );
    const scoresByScorecardId = new Map<string, AdjudicationScore[]>();
    const panelAveragePolicy = resolvePanelAveragePolicy(
      assignments,
      profiles,
    );

    for (const score of scores) {
      const scorecardScores = scoresByScorecardId.get(score.scorecard_id) ?? [];
      scorecardScores.push(score);
      scoresByScorecardId.set(score.scorecard_id, scorecardScores);
    }

    return assignments
      .filter((assignment) => assignment.can_score !== false)
      .map((assignment): PanelMemberScore => {
        const profile = profileById.get(assignment.adjudicator_user_id);
        const scorecard = scorecardByAssignmentId.get(assignment.id) ?? null;
        const memberScores = scorecard
          ? scoresByScorecardId.get(scorecard.id) ?? []
          : [];
        const scoreByCriterion = new Map(
          memberScores.map((score) => [score.criterion_id, score.score]),
        );
        const overall = calculateOverallProductionScore({
          categories,
          criteria,
          scores: scoreByCriterion,
        });

        return {
          assignment,
          name: profile?.full_name ?? profile?.email ?? "Panel member",
          scorecard,
          scoreByCriterion,
          overallAverage: overall.score,
          completedCategoryCount: overall.completedCategoryCount,
          scoreableCategoryCount: overall.scoreableCategoryCount,
          contributesToPanelAverage:
            panelAveragePolicy.contributorUserIds.has(
              assignment.adjudicator_user_id,
            ),
        };
      });
  }, [assignments, categories, criteria, profiles, scorecards, scores]);

  const criteriaByCategory = useMemo(() => {
    const grouped = new Map<string, ScoringCriterion[]>();
    for (const criterion of criteria) {
      const categoryCriteria = grouped.get(criterion.category_id) ?? [];
      categoryCriteria.push(criterion);
      grouped.set(criterion.category_id, categoryCriteria);
    }
    return grouped;
  }, [criteria]);
  const proposalByCategory = useMemo(
    () =>
      new Map(
        categoryProposals.map((proposal) => [
          proposal.category_id,
          proposal,
        ]),
      ),
    [categoryProposals],
  );

  if (!open) return null;

  const panelOverallAverage = scoreAverage(
    panelMembers.flatMap((member) =>
      member.contributesToPanelAverage && member.overallAverage != null
        ? [member.overallAverage]
        : [],
    ),
  );
  const contributingMemberCount = panelMembers.filter(
    (member) => member.contributesToPanelAverage,
  ).length;
  const advisoryReferenceMode = panelMembers.some(
    (member) => !member.contributesToPanelAverage,
  );

  return (
    <div
      className="modal-backdrop full-score-overview-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        aria-labelledby="full-score-overview-title"
        aria-modal="true"
        className="modal-card full-score-overview-modal"
        role="dialog"
      >
        <header className="modal-header sticky-modal-header">
          <div>
            <p className="eyebrow">Live panel scoring</p>
            <h2 id="full-score-overview-title">Full score view</h2>
            <p>
              Overall adjudicator averages and live panel averages for every
              applicable category.
            </p>
          </div>
          <button
            aria-label="Close full score view"
            className="modal-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <form action={saveRanges} className="full-score-overview-form">
          <div className="full-score-overview-body">
          {panelMembers.length > 0 ? (
            <div className="full-score-overview-table-wrap">
              <table className="data-table full-score-overview-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    {panelMembers.map((member) => (
                      <th key={member.assignment.id}>
                        <span className="full-score-member-name">
                          {member.name}
                        </span>
                        <span className="full-score-member-overall">
                          <small>Overall average</small>
                          <strong>
                            {formatScoreAverage(member.overallAverage)}
                          </strong>
                          <small>
                            {member.contributesToPanelAverage
                              ? `${member.completedCategoryCount}/${member.scoreableCategoryCount} categories complete`
                              : "Advisory reference only"}
                          </small>
                        </span>
                      </th>
                    ))}
                    <th className="full-score-panel-column">
                      <span className="full-score-member-name">Full panel</span>
                      <span className="full-score-member-overall">
                        <small>Overall average</small>
                        <strong>{formatScoreAverage(panelOverallAverage)}</strong>
                        <small>
                          {advisoryReferenceMode
                            ? `${contributingMemberCount} adjudicators; committee shown as reference`
                            : `${contributingMemberCount} scoring members`}
                        </small>
                      </span>
                    </th>
                    <th className="full-score-range-column">
                      <span className="full-score-member-name">
                        Natural range
                      </span>
                      <span className="full-score-member-overall">
                        <small>Automatic two-point check</small>
                      </span>
                    </th>
                    <th className="full-score-selected-range-column">
                      <span className="full-score-member-name">
                        Two-point range
                      </span>
                      <span className="full-score-member-overall">
                        <small>Synced with full category review</small>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => {
                    const categoryCriteria =
                      criteriaByCategory.get(category.id) ?? [];
                    const memberAverages = panelMembers.map((member) =>
                      categoryAverage(category, categoryCriteria, member),
                    );
                    const panelCategoryAverage = scoreAverage(
                      memberAverages.flatMap((value, index) =>
                        panelMembers[index]?.contributesToPanelAverage &&
                        value != null
                          ? [value]
                          : [],
                      ),
                    );
                    const contributingAverages = memberAverages.flatMap(
                      (value, index) =>
                        panelMembers[index]?.contributesToPanelAverage &&
                        value != null
                          ? [value]
                          : [],
                    );
                    const naturalRange =
                      category.category_key ===
                      OVERALL_PRODUCTION_CATEGORY_KEY
                        ? null
                        : deriveNaturalTwoPointRange(contributingAverages);
                    const hasComparableScores =
                      category.category_key !==
                        OVERALL_PRODUCTION_CATEGORY_KEY &&
                      contributingAverages.length >= 2;
                    const scoreMinimum = hasComparableScores
                      ? Math.min(...contributingAverages)
                      : null;
                    const scoreMaximum = hasComparableScores
                      ? Math.max(...contributingAverages)
                      : null;
                    const rangeStatus =
                      category.category_key ===
                      OVERALL_PRODUCTION_CATEGORY_KEY
                        ? "not-required"
                        : !hasComparableScores
                          ? "pending"
                          : naturalRange
                            ? "within"
                            : "outside";
                    const savedRangeStart = formatTwoPointRangeStart(
                      proposalByCategory.get(category.id)?.range_min,
                    );
                    const selectedRangeStart =
                      savedRangeStart ||
                      naturalRange?.rangeMinimum.toFixed(2) ||
                      "";

                    return (
                      <tr
                        className={`full-score-range-${rangeStatus}`}
                        key={category.id}
                      >
                        <th scope="row">
                          <span>Category {category.sort_order}</span>
                          <strong>{category.title}</strong>
                        </th>
                        {memberAverages.map((value, index) => (
                          <td key={panelMembers[index]?.assignment.id}>
                            <strong>{formatScoreAverage(value)}</strong>
                            <small>
                              {panelMembers[index]?.scorecard
                                ? panelMembers[index]?.contributesToPanelAverage
                                  ? panelMembers[index]?.scorecard?.status.replaceAll(
                                      "_",
                                      " ",
                                    )
                                  : "Advisory reference"
                                : "Not started"}
                            </small>
                          </td>
                        ))}
                        <td className="full-score-panel-column">
                          <strong>
                            {formatScoreAverage(panelCategoryAverage)}
                          </strong>
                          <small>
                            {memberAverages.filter(
                              (value, index) =>
                                value != null &&
                                panelMembers[index]?.contributesToPanelAverage,
                            ).length}
                            /{contributingMemberCount}{" "}
                            {advisoryReferenceMode
                              ? "adjudicators reporting"
                              : "members reporting"}
                          </small>
                        </td>
                        <td className="full-score-range-column">
                          {rangeStatus === "not-required" ? (
                            <>
                              <strong>Not required</strong>
                              <small>Overall Production</small>
                            </>
                          ) : naturalRange ? (
                            <>
                              <strong>
                                {naturalRange.rangeMinimum.toFixed(2)}–
                                {naturalRange.rangeMaximum.toFixed(2)}
                              </strong>
                              <small>Scores fit naturally</small>
                            </>
                          ) : hasComparableScores ? (
                            <>
                              <strong>Outside two points</strong>
                              <small>
                                {scoreMinimum?.toFixed(2)}–
                                {scoreMaximum?.toFixed(2)} live spread
                              </small>
                            </>
                          ) : (
                            <>
                              <strong>Waiting</strong>
                              <small>Two scores needed</small>
                            </>
                          )}
                        </td>
                        <td className="full-score-selected-range-column">
                          {rangeStatus === "not-required" ? (
                            <span className="full-score-range-not-required">
                              No range needed
                            </span>
                          ) : (
                            <>
                              <input
                                name="range_category_id"
                                type="hidden"
                                value={category.id}
                              />
                              <label
                                className="sr-only"
                                htmlFor={`full-score-range-${category.id}`}
                              >
                                Two-point range for {category.title}
                              </label>
                              <select
                                className="select full-score-range-select"
                                defaultValue={selectedRangeStart}
                                id={`full-score-range-${category.id}`}
                                name={`full_score_range_${category.id}`}
                              >
                                <option value="">Not set</option>
                                {rangeOptions.map((value) => (
                                  <option key={value} value={value.toFixed(2)}>
                                    {value.toFixed(2)}–{(value + 2).toFixed(2)}
                                  </option>
                                ))}
                              </select>
                              <small>
                                {proposalByCategory.get(category.id)?.status === "draft"
                                  ? "Saved draft"
                                  : proposalByCategory.has(category.id)
                                    ? "Current approved workflow value"
                                    : naturalRange
                                      ? "Suggested from live scores"
                                      : "Not selected"}
                              </small>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <h3>No scoring panel members</h3>
              <p>Assign scoring adjudicators to populate this view.</p>
            </div>
          )}
          </div>

          <footer className="sticky-modal-footer full-score-overview-footer">
            <div className="full-score-overview-footer-status">
              <span>Scores update as panel members save their scorecards.</span>
              {rangeSaveResult.message && (
                <strong aria-live="polite">{rangeSaveResult.message}</strong>
              )}
              {rangeSaveResult.error && (
                <strong className="form-error" role="alert">
                  {rangeSaveResult.error}
                </strong>
              )}
            </div>
            <div className="button-row">
              <button
                className="button button-secondary"
                onClick={onClose}
                type="button"
              >
                Done
              </button>
              <ScheduleSubmitButton
                className="button button-gold"
                pendingLabel="Saving ranges…"
              >
                Save ranges
              </ScheduleSubmitButton>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
