import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  AdjudicationScore,
  AdjudicationScorecard,
  AdjudicatorAssignment,
  Profile,
  ScoringCategory,
  ScoringCriterion,
} from "@/lib/types";

import { FullScoreOverviewModal } from "./full-score-overview-modal";

describe("FullScoreOverviewModal", () => {
  it("shows adjudicator overall averages and the panel average by category", () => {
    const categories = [
      {
        id: "music",
        category_key: "music_direction",
        title: "Music Direction",
        sort_order: 1,
      },
      {
        id: "overall",
        category_key: "overall_production",
        title: "Overall Production",
        sort_order: 16,
      },
    ] as ScoringCategory[];
    const criteria = [
      { id: "pitch", category_id: "music" },
      { id: "style", category_id: "music" },
      { id: "overall-criterion", category_id: "overall" },
    ] as ScoringCriterion[];
    const assignments = [
      {
        id: "assignment-one",
        adjudicator_user_id: "user-one",
        can_score: true,
      },
      {
        id: "assignment-two",
        adjudicator_user_id: "user-two",
        can_score: true,
      },
      {
        id: "comment-only",
        adjudicator_user_id: "commenter",
        can_score: false,
      },
    ] as AdjudicatorAssignment[];
    const scorecards = [
      {
        id: "scorecard-one",
        assignment_id: "assignment-one",
        status: "draft",
      },
      {
        id: "scorecard-two",
        assignment_id: "assignment-two",
        status: "draft",
      },
    ] as AdjudicationScorecard[];
    const scores = [
      { scorecard_id: "scorecard-one", criterion_id: "pitch", score: 8 },
      { scorecard_id: "scorecard-one", criterion_id: "style", score: 10 },
      { scorecard_id: "scorecard-two", criterion_id: "pitch", score: 6 },
      { scorecard_id: "scorecard-two", criterion_id: "style", score: 8 },
    ] as AdjudicationScore[];
    const profiles = [
      { id: "user-one", full_name: "Julie Rice" },
      { id: "user-two", full_name: "Amy Bridges" },
      { id: "commenter", full_name: "Comment Only" },
    ] as Profile[];

    const html = renderToStaticMarkup(
      <FullScoreOverviewModal
        assignments={assignments}
        categories={categories}
        criteria={criteria}
        onClose={() => undefined}
        open
        profiles={profiles}
        scorecards={scorecards}
        scores={scores}
      />,
    );

    expect(html).toContain("Full score view");
    expect(html).toContain("Julie Rice");
    expect(html).toContain("Amy Bridges");
    expect(html).not.toContain("Comment Only");
    expect(html).toContain("9.00000");
    expect(html).toContain("7.00000");
    expect(html).toContain("8.00000");
    expect(html).toContain("Music Direction");
    expect(html).toContain("Overall Production");
  });
});
