export const ADJUDICATION_RANGE_SELECTION_EVENT =
  "ghsmta:adjudication-range-selection";

export type AdjudicationRangeSelectionDetail = {
  applicationId: string;
  categoryId: string;
  rangeStart: string;
};

export function announceAdjudicationRangeSelection(
  detail: AdjudicationRangeSelectionDetail,
) {
  window.dispatchEvent(
    new CustomEvent<AdjudicationRangeSelectionDetail>(
      ADJUDICATION_RANGE_SELECTION_EVENT,
      { detail },
    ),
  );
}
