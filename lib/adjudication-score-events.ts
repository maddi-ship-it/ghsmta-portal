export const ADJUDICATION_SCORE_CHANGE_EVENT =
  "ghsmta:adjudication-score-change";

export type AdjudicationScoreChangeDetail = {
  criterionId: string;
  value: number | null;
};
