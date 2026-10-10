import { describe, expect, it } from "vitest";

import { isAdjudicationCategoryComplete } from "./adjudication-category-completion";

describe("isAdjudicationCategoryComplete", () => {
  it("completes when every criterion has a score and comment", () => {
    expect(
      isAdjudicationCategoryComplete({
        comments: ["<p>Strong diction.</p>", "<p>Balanced ensemble.</p>"],
        scores: [8, "9.25"],
      }),
    ).toBe(true);
  });

  it("stays incomplete when any comment is visually empty", () => {
    expect(
      isAdjudicationCategoryComplete({
        comments: ["<p>Strong diction.</p>", "<p>&nbsp;</p>"],
        scores: [8, 9.25],
      }),
    ).toBe(false);
  });

  it("stays incomplete when any score is missing", () => {
    expect(
      isAdjudicationCategoryComplete({
        comments: ["<p>Strong diction.</p>", "<p>Balanced ensemble.</p>"],
        scores: [8, ""],
      }),
    ).toBe(false);
  });

  it("stays incomplete when a score is outside the scoring scale", () => {
    expect(
      isAdjudicationCategoryComplete({
        comments: ["<p>Strong diction.</p>"],
        scores: [11],
      }),
    ).toBe(false);
  });

  it("does not require comments when commenting is disabled", () => {
    expect(
      isAdjudicationCategoryComplete({
        comments: [null, null],
        requireComments: false,
        scores: [8, 9.25],
      }),
    ).toBe(true);
  });

  it("does not complete an empty category", () => {
    expect(
      isAdjudicationCategoryComplete({ comments: [], scores: [] }),
    ).toBe(false);
  });
});
