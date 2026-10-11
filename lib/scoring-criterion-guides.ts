import guideDocument from "@/data/2026-2027-scoring-criterion-guides.json";

export type ScoringCriterionGuideLevel = {
  score: number;
  label: string;
  observable: string;
  example: string;
};

export type ScoringCriterionGuide = {
  category_key: string;
  sort_order: number;
  title: string;
  assessment_focus: string[];
  levels: ScoringCriterionGuideLevel[];
};

type ScoringCriterionGuideDocument = {
  source_document: string;
  season_year: string;
  criteria: ScoringCriterionGuide[];
};

const typedGuideDocument = guideDocument as ScoringCriterionGuideDocument;
const guideByCriterion = new Map(
  typedGuideDocument.criteria.map((guide) => [
    `${guide.category_key}:${guide.sort_order}`,
    guide,
  ]),
);

export const SCORING_CRITERION_GUIDE_SEASON =
  typedGuideDocument.season_year;
export const SCORING_CRITERION_GUIDE_SOURCE =
  typedGuideDocument.source_document;

export function getScoringCriterionGuide(
  categoryKey: string,
  sortOrder: number,
) {
  return guideByCriterion.get(`${categoryKey}:${sortOrder}`) ?? null;
}

export function listScoringCriterionGuides() {
  return typedGuideDocument.criteria;
}
