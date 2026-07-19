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
  defaultReason,
  scoreValues,
  disabled = false,
  onStateChange,
}: {
  categoryId: string;
  defaultEligible: boolean;
  defaultRangeStart: number | null | undefined;
  defaultReason: string | null | undefined;
  scoreValues: number[];
  disabled?: boolean;
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

      <label className="category-eligibility-control">
        <input
          checked={eligible}
          disabled={disabled}
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
          <small>Include this category in scoring</small>
        </span>
      </label>

      <label className="category-range-control">
        <span>2-point range</span>
        <select
          className="select"
          disabled={disabled || !eligible}
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

      {!eligible && (
        <label className="category-ineligibility-reason">
          <span>Reason not eligible</span>
          <input
            className="input"
            defaultValue={defaultReason ?? ""}
            disabled={disabled}
            name={`ineligibility_reason_${categoryId}`}
            placeholder="Brief reason"
          />
        </label>
      )}
    </div>
  );
}
