import { average } from "./adjudication";

export type SandboxEligibility = "" | "yes" | "no";

export type SandboxCriterionEntry = {
  score: number | null;
  comment: string;
};

export type SandboxCategoryDecision = {
  eligibility: SandboxEligibility;
  rangeMinimum: number | null;
};

export type SandboxCategoryState = {
  average: number | null;
  completedCommentCount: number;
  completedScoreCount: number;
  complete: boolean;
  rangeMaximum: number | null;
  withinRange: boolean | null;
};

export function calculateSandboxCategoryState({
  criterionIds,
  entries,
  decision,
}: {
  criterionIds: string[];
  entries: Record<string, SandboxCriterionEntry | undefined>;
  decision: SandboxCategoryDecision;
}): SandboxCategoryState {
  const criterionEntries = criterionIds.map(
    (criterionId) => entries[criterionId],
  );
  const completedScoreCount = criterionEntries.filter(
    (entry) => entry?.score != null && Number.isFinite(entry.score),
  ).length;
  const completedCommentCount = criterionEntries.filter((entry) =>
    Boolean(entry?.comment.trim()),
  ).length;
  const categoryAverage = average(
    criterionEntries.map((entry) => entry?.score),
  );
  const rangeMaximum =
    decision.rangeMinimum == null ? null : decision.rangeMinimum + 2;
  const withinRange =
    categoryAverage == null || decision.rangeMinimum == null
      ? null
      : categoryAverage >= decision.rangeMinimum &&
        categoryAverage <= decision.rangeMinimum + 2;
  const allCriteriaComplete =
    criterionIds.length > 0 &&
    completedScoreCount === criterionIds.length &&
    completedCommentCount === criterionIds.length;

  return {
    average: categoryAverage,
    completedCommentCount,
    completedScoreCount,
    complete:
      allCriteriaComplete &&
      decision.eligibility !== "" &&
      withinRange === true,
    rangeMaximum,
    withinRange,
  };
}
