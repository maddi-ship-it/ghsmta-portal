import { richTextHasContent } from "./rich-text";

export const ADJUDICATION_CATEGORY_COMPLETION_EVENT =
  "ghsmta:adjudication-category-completion";

export type AdjudicationCategoryCompletionDetail = {
  categoryId: string;
  complete: boolean;
};

export function isAdjudicationCategoryComplete({
  comments,
  requireComments = true,
  scores,
}: {
  comments: Array<string | null | undefined>;
  requireComments?: boolean;
  scores: Array<number | string | null | undefined>;
}) {
  const allScoresEntered =
    scores.length > 0 &&
    scores.every((score) => {
      if (score == null || String(score).trim() === "") return false;

      const numericScore = Number(score);
      return (
        Number.isFinite(numericScore) &&
        numericScore >= 1 &&
        numericScore <= 10
      );
    });

  if (!allScoresEntered) return false;
  if (!requireComments) return true;

  return (
    comments.length === scores.length &&
    comments.every((comment) => richTextHasContent(comment))
  );
}
