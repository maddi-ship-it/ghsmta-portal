import { describe, expect, it } from "vitest";

import { isAdjudicationCategoryComplete } from "./adjudication-category-completion";

describe("isAdjudicationCategoryComplete", () => {
  it("requires every criterion comment and an approved range", () => {
    expect(
      isAdjudicationCategoryComplete({
        comments: ["<p>Strong diction.</p>", "<p>Balanced ensemble.</p>"],
        rangeApproved: true,
      }),
    ).toBe(true);
  });

  it("stays incomplete when any comment is visually empty", () => {
    expect(
      isAdjudicationCategoryComplete({
        comments: ["<p>Strong diction.</p>", "<p>&nbsp;</p>"],
        rangeApproved: true,
      }),
    ).toBe(false);
  });

  it("stays incomplete until the range is approved", () => {
    expect(
      isAdjudicationCategoryComplete({
        comments: ["<p>Strong diction.</p>"],
        rangeApproved: false,
      }),
    ).toBe(false);
  });

  it("does not complete an empty category", () => {
    expect(
      isAdjudicationCategoryComplete({ comments: [], rangeApproved: true }),
    ).toBe(false);
  });
});
