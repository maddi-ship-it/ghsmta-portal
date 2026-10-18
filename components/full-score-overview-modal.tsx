"use client";

import { useEffect, useMemo } from "react";

import {
  average as scoreAverage,
  formatScoreAverage,
} from "@/lib/adjudication";
import {
  calculateOverallProductionScore,
  OVERALL_PRODUCTION_CATEGORY_KEY,
} from "@/lib/adjudication-overall-score";
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
};

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
  assignments,
  categories,
  criteria,
  onClose,
  open,
  profiles,
  scorecards,
  scores,
}: {
  assignments: AdjudicatorAssignment[];
  categories: ScoringCategory[];
  criteria: ScoringCriterion[];
  onClose: () => void;
  open: boolean;
  profiles: Profile[];
  scorecards: AdjudicationScorecard[];
  scores: AdjudicationScore[];
}) {
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

  if (!open) return null;

  const panelOverallAverage = scoreAverage(
    panelMembers.flatMap((member) =>
      member.overallAverage == null ? [] : [member.overallAverage],
    ),
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
                            {member.completedCategoryCount}/
                            {member.scoreableCategoryCount} categories complete
                          </small>
                        </span>
                      </th>
                    ))}
                    <th className="full-score-panel-column">
                      <span className="full-score-member-name">Full panel</span>
                      <span className="full-score-member-overall">
                        <small>Overall average</small>
                        <strong>{formatScoreAverage(panelOverallAverage)}</strong>
                        <small>{panelMembers.length} scoring members</small>
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
                      memberAverages.flatMap((value) =>
                        value == null ? [] : [value],
                      ),
                    );

                    return (
                      <tr key={category.id}>
                        <th scope="row">
                          <span>Category {category.sort_order}</span>
                          <strong>{category.title}</strong>
                        </th>
                        {memberAverages.map((value, index) => (
                          <td key={panelMembers[index]?.assignment.id}>
                            <strong>{formatScoreAverage(value)}</strong>
                            <small>
                              {panelMembers[index]?.scorecard
                                ? panelMembers[index]?.scorecard?.status.replaceAll(
                                    "_",
                                    " ",
                                  )
                                : "Not started"}
                            </small>
                          </td>
                        ))}
                        <td className="full-score-panel-column">
                          <strong>
                            {formatScoreAverage(panelCategoryAverage)}
                          </strong>
                          <small>
                            {memberAverages.filter((value) => value != null).length}/
                            {panelMembers.length} members reporting
                          </small>
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
          <span>Scores update as panel members save their scorecards.</span>
          <button className="button button-dark" onClick={onClose} type="button">
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
