import { describe, expect, it } from "vitest";

import { calculateSandboxCategoryState } from "./adjudication-sandbox";

describe("calculateSandboxCategoryState", () => {
  it("marks a category complete when every score and comment is within range", () => {
    expect(
      calculateSandboxCategoryState({
        criterionIds: ["one", "two"],
        entries: {
          one: { score: 8, comment: "Specific observation" },
          two: { score: 8.5, comment: "Another observation" },
        },
        decision: { eligibility: "yes", rangeMinimum: 7 },
      }),
    ).toMatchObject({
      average: 8.25,
      completedCommentCount: 2,
      completedScoreCount: 2,
      complete: true,
      rangeMaximum: 9,
      withinRange: true,
    });
  });

  it("keeps a fully entered category incomplete when its average is outside the range", () => {
    const state = calculateSandboxCategoryState({
      criterionIds: ["one", "two"],
      entries: {
        one: { score: 9.5, comment: "Specific observation" },
        two: { score: 10, comment: "Another observation" },
      },
      decision: { eligibility: "no", rangeMinimum: 6 },
    });

    expect(state.average).toBe(9.75);
    expect(state.withinRange).toBe(false);
    expect(state.complete).toBe(false);
  });

  it("requires comments, scores, and a committee decision", () => {
    expect(
      calculateSandboxCategoryState({
        criterionIds: ["one", "two"],
        entries: {
          one: { score: 8, comment: "" },
          two: { score: null, comment: "Observation" },
        },
        decision: { eligibility: "", rangeMinimum: null },
      }),
    ).toMatchObject({
      completedCommentCount: 1,
      completedScoreCount: 1,
      complete: false,
      withinRange: null,
    });
  });
});
