import { describe, expect, it } from "vitest";

import { calculateOverallProductionScore } from "./adjudication-overall-score";
import type { ScoringCategory, ScoringCriterion } from "./types";

function category(id: string, key = id): ScoringCategory {
  return {
    id,
    rubric_id: "rubric",
    category_key: key,
    title: id,
    description: null,
    guidance: null,
    subject_label: null,
    sort_order: 1,
    required: true,
    allow_not_applicable: false,
    active: true,
    created_at: "",
    updated_at: "",
  };
}

function criterion(id: string, categoryId: string): ScoringCriterion {
  return {
    id,
    category_id: categoryId,
    criterion_key: id,
    title: id,
    description: null,
    weight: 1,
    sort_order: 1,
    active: true,
    created_at: "",
    updated_at: "",
  };
}

describe("calculateOverallProductionScore", () => {
  it("averages category averages with equal category weight", () => {
    const categories = [
      category("music"),
      category("acting"),
      category("overall", "overall_production"),
    ];
    const criteria = [
      criterion("music-1", "music"),
      criterion("music-2", "music"),
      criterion("acting-1", "acting"),
      criterion("overall-1", "overall"),
    ];

    expect(
      calculateOverallProductionScore({
        categories,
        criteria,
        scores: new Map([
          ["music-1", 10],
          ["music-2", 8],
          ["acting-1", 6],
        ]),
      }),
    ).toEqual({
      score: 7.5,
      completedCategoryCount: 2,
      scoreableCategoryCount: 2,
    });
  });

  it("excludes non-scoreable categories from both the score and denominator", () => {
    expect(
      calculateOverallProductionScore({
        categories: [category("music"), category("acting")],
        criteria: [
          criterion("music-1", "music"),
          criterion("acting-1", "acting"),
        ],
        scores: new Map([
          ["music-1", 8],
          ["acting-1", 2],
        ]),
        unscoreableCategoryIds: new Set(["acting"]),
      }),
    ).toEqual({
      score: 8,
      completedCategoryCount: 1,
      scoreableCategoryCount: 1,
    });
  });

  it("uses only fully scored categories for a live draft average", () => {
    expect(
      calculateOverallProductionScore({
        categories: [category("music"), category("acting")],
        criteria: [
          criterion("music-1", "music"),
          criterion("music-2", "music"),
          criterion("acting-1", "acting"),
        ],
        scores: new Map([
          ["music-1", 9],
          ["music-2", null],
          ["acting-1", 7.25],
        ]),
      }),
    ).toEqual({
      score: 7.25,
      completedCategoryCount: 1,
      scoreableCategoryCount: 2,
    });
  });
});
