const TWO_POINT_RANGE_WIDTH = 2;
const SCORE_INCREMENT = 0.25;

export function formatTwoPointRangeStart(
  value: number | string | null | undefined,
) {
  if (value == null || value === "") return "";

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : "";
}

export function twoPointRangeFromStart(
  value: number | string | null | undefined,
  scoreMinimum = 1,
  scoreMaximum = 10,
) {
  if (value == null || value === "") return null;

  const rangeMinimum = Number(value);
  const rangeMaximum = Number(
    (rangeMinimum + TWO_POINT_RANGE_WIDTH).toFixed(2),
  );
  const incrementCount = rangeMinimum / SCORE_INCREMENT;
  const usesQuarterPointIncrement =
    Math.abs(incrementCount - Math.round(incrementCount)) < 0.0001;

  if (
    !Number.isFinite(rangeMinimum) ||
    !Number.isFinite(rangeMaximum) ||
    !usesQuarterPointIncrement ||
    rangeMinimum < scoreMinimum ||
    rangeMaximum > scoreMaximum
  ) {
    return null;
  }

  return {
    rangeMinimum,
    rangeMaximum,
  };
}
