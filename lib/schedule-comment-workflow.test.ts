import { describe, expect, it } from "vitest";

import { buildScheduleCommentWorkflowMilestones } from "./schedule-comment-workflow";

describe("schedule comment workflow milestones", () => {
  const applications = [{ id: "app-1", form_version_id: "form-1" }];
  const formVersions = [{ id: "form-1", scoring_rubric_id: "rubric-1" }];
  const categories = [
    {
      id: "category-1",
      rubric_id: "rubric-1",
      category_key: "music_direction",
    },
    {
      id: "category-2",
      rubric_id: "rubric-1",
      category_key: "orchestra",
    },
    {
      id: "overall",
      rubric_id: "rubric-1",
      category_key: "overall_production",
    },
  ];
  const assignments = [
    {
      application_id: "app-1",
      adjudicator_user_id: "writer-1",
      can_comment: true,
      removed_at: null,
    },
  ];

  it("distinguishes Owner-sent comments from panel-approved comments", () => {
    const base = {
      applications,
      formVersions,
      categories,
      scoreability: [
        {
          application_id: "app-1",
          category_id: "category-2",
          is_scoreable: false,
        },
      ],
      assignments,
    };
    const sent = buildScheduleCommentWorkflowMilestones({
      ...base,
      feedback: [
        {
          application_id: "app-1",
          category_id: "category-1",
          status: "approved",
          final_comment: "Owner draft sent to the panel.",
          assigned_to: "writer-1",
          approved_by: "owner-1",
        },
      ],
    }).get("app-1");
    const approved = buildScheduleCommentWorkflowMilestones({
      ...base,
      feedback: [
        {
          application_id: "app-1",
          category_id: "category-1",
          status: "approved",
          final_comment: "Panel-approved final comment.",
          assigned_to: "writer-1",
          approved_by: "writer-1",
        },
      ],
    }).get("app-1");

    expect(sent).toEqual({
      commentsSentToAdjudicators: true,
      allCommentsReviewedAndApproved: false,
    });
    expect(approved).toEqual({
      commentsSentToAdjudicators: true,
      allCommentsReviewedAndApproved: true,
    });
  });

  it("does not mark a partial set of comments as sent", () => {
    const milestones = buildScheduleCommentWorkflowMilestones({
      applications,
      formVersions,
      categories,
      scoreability: [],
      assignments,
      feedback: [
        {
          application_id: "app-1",
          category_id: "category-1",
          status: "approved",
          final_comment: "Only one category is ready.",
          assigned_to: "writer-1",
          approved_by: "writer-1",
        },
      ],
    }).get("app-1");

    expect(milestones).toEqual({
      commentsSentToAdjudicators: false,
      allCommentsReviewedAndApproved: false,
    });
  });
});
