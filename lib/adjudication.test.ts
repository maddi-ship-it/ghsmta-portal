import { describe, expect, it } from "vitest";

import { buildCommentContext } from "./adjudication";
import type {
  AdjudicationCategoryComment,
  AdjudicationScore,
  ScoringCategory,
  ScoringCriterion,
} from "./types";

const category = {
  id: "category-1",
  rubric_id: "rubric-1",
  category_key: "music_direction",
  title: "Music Direction",
  description: null,
  guidance: null,
  subject_label: null,
  sort_order: 1,
  required: true,
  allow_not_applicable: false,
  active: true,
  created_at: "",
  updated_at: "",
} satisfies ScoringCategory;

const criteria = [
  {
    id: "criterion-1",
    category_id: category.id,
    criterion_key: "vocal_performance",
    title: "Vocal performance",
    description: "Pitch, rhythm, diction, and breath support.",
    weight: 1,
    sort_order: 1,
    active: true,
    created_at: "",
    updated_at: "",
  },
  {
    id: "criterion-2",
    category_id: category.id,
    criterion_key: "story_depiction",
    title: "Story depiction",
    description: "Pacing, transitions, and energy.",
    weight: 1,
    sort_order: 2,
    active: true,
    created_at: "",
    updated_at: "",
  },
] satisfies ScoringCriterion[];

const comments = [
  {
    id: "comment-1",
    scorecard_id: "scorecard-1",
    category_id: category.id,
    subject_name: "Student Name (Jack Kelly)",
    is_applicable: true,
    is_eligible: true,
    not_applicable_reason: null,
    score_range_min: null,
    score_range_max: null,
    successes: "<p>Clear musical storytelling.</p>",
    success_examples: null,
    growth_areas: "<p>Diction became less consistent.</p>",
    growth_examples: null,
    private_notes: null,
    created_at: "",
    updated_at: "",
  },
] satisfies AdjudicationCategoryComment[];

const scores = [
  {
    id: "score-1",
    scorecard_id: "scorecard-1",
    criterion_id: "criterion-1",
    score: 8,
    observation: "<p>Strong pitch with occasional blurred consonants.</p>",
    created_at: "",
    updated_at: "",
  },
] satisfies AdjudicationScore[];

describe("buildCommentContext", () => {
  it("organizes observations by criterion without sending student names", () => {
    const context = buildCommentContext(category, criteria, comments, scores);

    expect(context.rawComments).toContain("Criterion: Vocal performance");
    expect(context.rawComments).toContain(
      "Role: Jack Kelly: Strong pitch with occasional blurred consonants.",
    );
    expect(context.rawComments).toContain("Criterion: Story depiction");
    expect(context.rawComments).toContain(
      "No criterion-specific observation was supplied.",
    );
    expect(context.rawComments).toContain("Clear musical storytelling.");
    expect(context.rawComments).not.toContain("Student Name");
  });
});
