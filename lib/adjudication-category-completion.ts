import { richTextHasContent } from "./rich-text";

export const ADJUDICATION_CATEGORY_COMPLETION_EVENT =
  "ghsmta:adjudication-category-completion";

export type AdjudicationCategoryCompletionDetail = {
  categoryId: string;
  complete: boolean;
};

export function isAdjudicationCategoryComplete({
  comments,
  rangeApproved,
}: {
  comments: Array<string | null | undefined>;
  rangeApproved: boolean;
}) {
  return (
    rangeApproved &&
    comments.length > 0 &&
    comments.every((comment) => richTextHasContent(comment))
  );
}
