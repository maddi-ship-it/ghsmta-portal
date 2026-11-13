import { describe, expect, it } from "vitest";

import {
  activeAdjudicatorAssignmentIds,
  allScorecardsSubmittedPanelAnnouncement,
  scorecardSubmissionMilestoneId,
  submittedAdjudicatorScorecards,
} from "./adjudication-scorecard-notifications";

const assignments = [
  {
    id: "assignment-1",
    adjudicator_user_id: "user-1",
    can_score: true,
    participant_role: "adjudicator",
    removed_at: null,
  },
  {
    id: "assignment-2",
    adjudicator_user_id: "user-2",
    can_score: true,
    participant_role: null,
    removed_at: null,
  },
  {
    id: "assignment-acm",
    adjudicator_user_id: "user-acm",
    can_score: true,
    participant_role: "advisory_member",
    removed_at: null,
  },
];

describe("scorecard submission notifications", () => {
  it("requires only production-role adjudicators, not the advisory reference score", () => {
    expect(
      activeAdjudicatorAssignmentIds({
        assignments,
        profiles: [
          { id: "user-1", role: "adjudicator" },
          { id: "user-2", role: "adjudicator" },
          { id: "user-acm", role: "advisory_member" },
        ],
      }),
    ).toEqual(["assignment-1", "assignment-2"]);
  });

  it("announces completion only after every adjudicator scorecard is submitted", () => {
    const scorecards = [
      {
        assignment_id: "assignment-1",
        status: "submitted",
        submitted_at: "2026-11-12T20:00:00.000Z",
      },
      {
        assignment_id: "assignment-2",
        status: "locked",
        submitted_at: "2026-11-12T20:05:00.000Z",
      },
    ];

    expect(
      submittedAdjudicatorScorecards({
        assignmentIds: ["assignment-1", "assignment-2"],
        scorecards,
      }),
    ).toEqual(scorecards);
    expect(
      submittedAdjudicatorScorecards({
        assignmentIds: ["assignment-1", "assignment-2", "assignment-3"],
        scorecards,
      }),
    ).toEqual([]);
  });

  it("builds a stable milestone ID and a clear panel announcement", () => {
    const scorecards = [
      {
        assignment_id: "assignment-2",
        status: "submitted",
        submitted_at: "2026-11-12T20:05:00.000Z",
      },
      {
        assignment_id: "assignment-1",
        status: "submitted",
        submitted_at: "2026-11-12T20:00:00.000Z",
      },
    ];
    const firstId = scorecardSubmissionMilestoneId({
      applicationId: "application-1",
      scorecards,
    });
    const secondId = scorecardSubmissionMilestoneId({
      applicationId: "application-1",
      scorecards: [...scorecards].reverse(),
    });

    expect(firstId).toBe(secondId);
    expect(firstId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(
      allScorecardsSubmittedPanelAnnouncement({
        schoolName: "King's Ridge Christian School",
        productionTitle: "Fiddler on the Roof",
        adjudicatorCount: 3,
      }),
    ).toContain("ready for final comment generation");
  });
});
