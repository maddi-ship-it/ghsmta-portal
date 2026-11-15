import { describe, expect, it } from "vitest";

import {
  categoryCommentDraftRowChanged,
  scoreDraftRowChanged,
} from "./adjudication-scorecard-draft";

describe("scorecard draft change detection", () => {
  it("does not rewrite an unchanged score and observation", () => {
    expect(
      scoreDraftRowChanged(
        { criterion_id: "criterion-1", observation: "Good detail", score: 8 },
        { criterion_id: "criterion-1", observation: "Good detail", score: 8 },
      ),
    ).toBe(false);
  });

  it("detects a changed observation", () => {
    expect(
      scoreDraftRowChanged(
        { criterion_id: "criterion-1", observation: "Earlier note", score: 8 },
        { criterion_id: "criterion-1", observation: "Updated note", score: 8 },
      ),
    ).toBe(true);
  });

  it("does not compare fields the current role cannot edit", () => {
    expect(
      scoreDraftRowChanged(
        { criterion_id: "criterion-1", observation: "Panel note", score: 8 },
        { criterion_id: "criterion-1", score: 8 },
      ),
    ).toBe(false);
  });

  it("does not rewrite an unchanged category comment", () => {
    const existing = {
      category_id: "category-1",
      subject_name: "Jordan Lee",
      is_applicable: true,
      is_eligible: true,
      not_applicable_reason: null,
      score_range_min: 7,
      score_range_max: 9,
      private_notes: "Existing note",
    };

    expect(categoryCommentDraftRowChanged(existing, existing)).toBe(false);
  });

  it("preserves private notes when the current role cannot edit them", () => {
    expect(
      categoryCommentDraftRowChanged(
        {
          category_id: "category-1",
          subject_name: null,
          is_applicable: true,
          is_eligible: true,
          not_applicable_reason: null,
          score_range_min: 7,
          score_range_max: 9,
          private_notes: "Panel note",
        },
        {
          category_id: "category-1",
          subject_name: null,
          is_applicable: true,
          is_eligible: true,
          not_applicable_reason: null,
          score_range_min: 7,
          score_range_max: 9,
        },
      ),
    ).toBe(false);
  });
});
