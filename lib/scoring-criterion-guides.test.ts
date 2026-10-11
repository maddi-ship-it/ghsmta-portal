import { describe, expect, it } from "vitest";

import {
  getScoringCriterionGuide,
  listScoringCriterionGuides,
  SCORING_CRITERION_GUIDE_SEASON,
} from "./scoring-criterion-guides";

describe("scoring criterion guides", () => {
  it("contains one complete 10-through-1 guide for every current criterion", () => {
    const guides = listScoringCriterionGuides();
    const keys = guides.map(
      (guide) => `${guide.category_key}:${guide.sort_order}`,
    );

    expect(SCORING_CRITERION_GUIDE_SEASON).toBe("2026-2027");
    expect(guides).toHaveLength(58);
    expect(new Set(keys).size).toBe(58);

    for (const guide of guides) {
      expect(guide.assessment_focus.length).toBeGreaterThanOrEqual(4);
      expect(guide.levels.map((level) => level.score)).toEqual([
        10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
      ]);
      expect(
        guide.levels.every(
          (level) => level.observable.length > 0 && level.example.length > 0,
        ),
      ).toBe(true);
    }
  });

  it("returns the exact guide for a category and criterion order", () => {
    const guide = getScoringCriterionGuide("orchestra", 2);

    expect(guide?.title).toBe("MUSICAL EXPRESSION AND INTERPRETATION");
    expect(guide?.levels[0]).toMatchObject({
      score: 10,
      label: "Superior",
    });
    expect(getScoringCriterionGuide("overall_production", 1)).toBeNull();
  });
});
