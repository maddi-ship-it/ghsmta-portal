const TWO_POINT_RANGE_WIDTH = 2;
const SCORE_INCREMENT = 0.25;
const FLOAT_TOLERANCE = 0.0001;

export type NaturalTwoPointRange = {
  rangeMinimum: number;
  rangeMaximum: number;
  scoreMinimum: number;
  scoreMaximum: number;
  spread: number;
};

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

export function isValidTwoPointRange(
  minimum: number | string | null | undefined,
  maximum: number | string | null | undefined,
  scoreMinimum = 1,
  scoreMaximum = 10,
) {
  if (maximum == null || maximum === "") return false;

  const range = twoPointRangeFromStart(
    minimum,
    scoreMinimum,
    scoreMaximum,
  );
  const numericMaximum = Number(maximum);

  return Boolean(
    range &&
      Number.isFinite(numericMaximum) &&
      Math.abs(range.rangeMaximum - numericMaximum) < 0.0001,
  );
}

export function deriveNaturalTwoPointRange(
  values: Array<number | null | undefined>,
  allowedScoreMinimum = 1,
  allowedScoreMaximum = 10,
): NaturalTwoPointRange | null {
  const scores = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );

  if (scores.length < 2) return null;

  const scoreMinimum = Math.min(...scores);
  const scoreMaximum = Math.max(...scores);
  const minimumPossibleStart = Math.max(
    allowedScoreMinimum,
    scoreMaximum - TWO_POINT_RANGE_WIDTH,
  );
  const maximumPossibleStart = Math.min(
    scoreMinimum,
    allowedScoreMaximum - TWO_POINT_RANGE_WIDTH,
  );
  const firstValidStart =
    Math.ceil(
      (minimumPossibleStart - FLOAT_TOLERANCE) / SCORE_INCREMENT,
    ) * SCORE_INCREMENT;
  const lastValidStart =
    Math.floor(
      (maximumPossibleStart + FLOAT_TOLERANCE) / SCORE_INCREMENT,
    ) * SCORE_INCREMENT;

  if (firstValidStart > lastValidStart + FLOAT_TOLERANCE) return null;

  const centeredStart =
    (scoreMinimum + scoreMaximum) / 2 - TWO_POINT_RANGE_WIDTH / 2;
  const roundedCenteredStart =
    Math.round(centeredStart / SCORE_INCREMENT) * SCORE_INCREMENT;
  const rangeMinimum = Number(
    Math.min(
      lastValidStart,
      Math.max(firstValidStart, roundedCenteredStart),
    ).toFixed(2),
  );
  const rangeMaximum = Number(
    (rangeMinimum + TWO_POINT_RANGE_WIDTH).toFixed(2),
  );

  return {
    rangeMinimum,
    rangeMaximum,
    scoreMinimum,
    scoreMaximum,
    spread: Number((scoreMaximum - scoreMinimum).toFixed(5)),
  };
}
