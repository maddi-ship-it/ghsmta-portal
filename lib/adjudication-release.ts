import type { ReleasedFeedbackSummary } from "@/lib/types";

export function mergeReleasedFeedback(
  current: ReleasedFeedbackSummary[],
  selected: ReleasedFeedbackSummary[],
) {
  const selectedCategoryIds = new Set(
    selected.map((item) => item.category_id),
  );

  return [
    ...current.filter(
      (item) => !selectedCategoryIds.has(item.category_id),
    ),
    ...selected,
  ].sort(
    (left, right) =>
      left.sort_order - right.sort_order ||
      left.title.localeCompare(right.title),
  );
}

export function updateSelectedCategoryIds(
  current: Set<string>,
  categoryId: string,
  checked: boolean,
) {
  const next = new Set(current);
  if (checked) {
    next.add(categoryId);
  } else {
    next.delete(categoryId);
  }
  return next;
}
