import type { ScoringCategory, ScoringCriterion } from "./types";

export const OVERALL_PRODUCTION_CATEGORY_KEY = "overall_production";

export type OverallProductionScore = {
  score: number | null;
  completedCategoryCount: number;
  scoreableCategoryCount: number;
};

export function calculateOverallProductionScore({
  categories,
  criteria,
  scores,
  unscoreableCategoryIds = new Set<string>(),
}: {
  categories: ScoringCategory[];
  criteria: ScoringCriterion[];
  scores: ReadonlyMap<string, number | null | undefined>;
  unscoreableCategoryIds?: ReadonlySet<string>;
}): OverallProductionScore {
  const sourceCategories = categories.filter(
    (category) =>
      category.category_key !== OVERALL_PRODUCTION_CATEGORY_KEY &&
      !unscoreableCategoryIds.has(category.id),
  );
  const categoryAverages: number[] = [];

  for (const category of sourceCategories) {
    const categoryCriteria = criteria.filter(
      (criterion) => criterion.category_id === category.id,
    );
    const categoryScores = categoryCriteria.map((criterion) =>
      scores.get(criterion.id),
    );

    if (
      categoryCriteria.length === 0 ||
      categoryScores.some(
        (score) => score == null || !Number.isFinite(Number(score)),
      )
    ) {
      continue;
    }

    const numericCategoryScores = categoryScores.map((score) => Number(score));
    categoryAverages.push(
      numericCategoryScores.reduce((sum, score) => sum + score, 0) /
        numericCategoryScores.length,
    );
  }

  const score =
    categoryAverages.length === 0
      ? null
      : Number(
          (
            categoryAverages.reduce((sum, average) => sum + average, 0) /
            categoryAverages.length
          ).toFixed(5),
        );

  return {
    score,
    completedCategoryCount: categoryAverages.length,
    scoreableCategoryCount: sourceCategories.length,
  };
}
