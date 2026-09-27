import { describe, expect, it } from "vitest";

import {
  buildScoringGuideContext,
  calculateLivePanelCategoryAverage,
  resolvePanelCommentScoringContext,
} from "./panel-comment-context";
import type {
  AdjudicationScore,
  AdjudicationScorecard,
  ScoringCriterion,
  ScoringScaleLevel,
} from "./types";

const criteria = [
  {
    id: "criterion-1",
    category_id: "category-1",
    criterion_key: "one",
    title: "Criterion one",
    description: null,
    weight: 1,
    sort_order: 1,
    active: true,
    created_at: "",
    updated_at: "",
  },
  {
    id: "criterion-2",
    category_id: "category-1",
    criterion_key: "two",
    title: "Criterion two",
    description: null,
    weight: 1,
    sort_order: 2,
    active: true,
    created_at: "",
    updated_at: "",
  },
] satisfies ScoringCriterion[];

const scorecards = [
  {
    id: "scorecard-1",
    assignment_id: "assignment-1",
    application_id: "application-1",
    adjudicator_user_id: "user-1",
    rubric_id: "rubric-1",
    status: "draft",
    submitted_at: null,
    reopened_at: null,
    internal_notes: null,
    created_at: "",
    updated_at: "",
  },
] satisfies AdjudicationScorecard[];

describe("panel comment context", () => {
  it("calculates a live category average before submission", () => {
    const scores = [
      {
        id: "score-1",
        scorecard_id: "scorecard-1",
        criterion_id: "criterion-1",
        score: 8,
        observation: null,
        created_at: "",
        updated_at: "",
      },
      {
        id: "score-2",
        scorecard_id: "scorecard-1",
        criterion_id: "criterion-2",
        score: 9,
        observation: null,
        created_at: "",
        updated_at: "",
      },
    ] satisfies AdjudicationScore[];

    expect(
      calculateLivePanelCategoryAverage(
        "category-1",
        criteria,
        scorecards,
        scores,
      ),
    ).toBe(8.5);
  });

  it("formats the official scoring scale for the model", () => {
    const levels = [
      {
        id: "level-10",
        rubric_id: "rubric-1",
        score: 10,
        label: "Superior",
        description: "Always demonstrated.",
        sort_order: 1,
      },
      {
        id: "level-9",
        rubric_id: "rubric-1",
        score: 9,
        label: "Excellent+",
        description: "Nearly always demonstrated.",
        sort_order: 2,
      },
    ] satisfies ScoringScaleLevel[];

    expect(
      buildScoringGuideContext(
        { name: "Director rubric", score_min: 1, score_max: 10 },
        levels,
      ),
    ).toContain("10 — Superior: Always demonstrated.");
  });

  it("withholds the score for mentorship applications", () => {
    expect(
      resolvePanelCommentScoringContext({
        selectedTrack: "Mentorship Track",
        cycleProgramType: "directors",
        panelAverage: 8.5,
      }),
    ).toEqual({
      programTrack: "Mentorship Track",
      scoringMode: "MENTORSHIP ONLY",
      averagePanelScore:
        "Not supplied because this application is mentorship only.",
    });
  });
});
