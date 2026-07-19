"use client";

import { useMemo, useState } from "react";

type RangeOption = {
  start: number;
  end: number;
};

type CategoryDecision = {
  eligible: boolean;
  rangeStart: number | null;
};

function formatRangeValue(value: number) {
  return value.toFixed(2);
}

export function CategoryScoringControls({
  categoryId,
  defaultEligible,
  defaultRangeStart,
  scoreValues,
  disabled = false,
  locked = false,
  onStateChange,
}: {
  categoryId: string;
  defaultEligible: boolean;
  defaultRangeStart: number | null | undefined;
  scoreValues: number[];
  disabled?: boolean;
  locked?: boolean;
  onStateChange?: (decision: CategoryDecision) => void;
}) {
  const [eligible, setEligible] = useState(defaultEligible);
  const [rangeStart, setRangeStart] = useState<number | null>(
    defaultRangeStart == null ? null : Number(defaultRangeStart),
  );

  const rangeOptions = useMemo<RangeOption[]>(() => {
    const uniqueValues = [...new Set(scoreValues.map(Number))]
      .filter(Number.isFinite)
      .sort((a, b) => b - a);

    const maximum = uniqueValues[0] ?? 10;

    return uniqueValues
      .filter((start) => start + 2 <= maximum + 0.0001)
      .map((start) => ({
        start,
        end: Number((start + 2).toFixed(2)),
      }));
  }, [scoreValues]);

  const updateDecision = (
    nextEligible: boolean,
    nextRangeStart: number | null,
  ) => {
    onStateChange?.({
      eligible: nextEligible,
      rangeStart: nextRangeStart,
    });
  };

  return (
    <div className="category-scoring-controls">
      <input
        name={`eligibility_control_${categoryId}`}
        type="hidden"
        value="1"
      />

      {locked && eligible && (
        <input name={`eligible_${categoryId}`} type="hidden" value="on" />
      )}
      {locked && eligible && rangeStart != null && (
        <input
          name={`score_range_start_${categoryId}`}
          type="hidden"
          value={formatRangeValue(rangeStart)}
        />
      )}

      <label className="category-eligibility-control">
        <input
          checked={eligible}
          disabled={disabled || locked}
          name={`eligible_${categoryId}`}
          onChange={(event) => {
            const nextEligible = event.target.checked;
            setEligible(nextEligible);
            updateDecision(nextEligible, rangeStart);
          }}
          type="checkbox"
        />
        <span>
          <strong>Eligible</strong>
          <small>{locked ? "Set by Advisory Committee" : "Include this category in scoring"}</small>
        </span>
      </label>

      <label className="category-range-control">
        <span>2-point range</span>
        <select
          className="select"
          disabled={disabled || locked || !eligible}
          name={`score_range_start_${categoryId}`}
          onChange={(event) => {
            const nextRangeStart = event.target.value
              ? Number(event.target.value)
              : null;
            setRangeStart(nextRangeStart);
            updateDecision(eligible, nextRangeStart);
          }}
          value={rangeStart == null ? "" : formatRangeValue(rangeStart)}
        >
          <option value="">Select range</option>
          {rangeOptions.map((option) => (
            <option
              key={option.start}
              value={formatRangeValue(option.start)}
            >
              {formatRangeValue(option.start)}–{formatRangeValue(option.end)}
            </option>
          ))}
        </select>
      </label>

      {locked && (
        <small className="field-help category-decision-lock-note">
          Eligibility and range are controlled by the approved panel decision.
        </small>
      )}
    </div>
  );
}
