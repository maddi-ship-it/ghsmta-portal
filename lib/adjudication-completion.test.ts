import { describe, expect, it } from "vitest";

import {
  canCompleteAdjudication,
  outstandingAssignedFinalComments,
} from "./adjudication-completion";

const adjudicatorId = "adjudicator-1";

describe("adjudication completion", () => {
  it("allows completion after a submitted scorecard when no comments are assigned", () => {
    expect(
      canCompleteAdjudication({
        adjudicatorUserId: adjudicatorId,
        feedback: [],
        scorecardStatus: "submitted",
      }),
    ).toBe(true);
  });

  it("keeps completion blocked until every assigned comment is returned", () => {
    const feedback = [
      {
        assigned_to: adjudicatorId,
        approved_by: "owner-1",
        status: "approved",
      },
      {
        assigned_to: adjudicatorId,
        approved_by: adjudicatorId,
        status: "approved",
      },
      {
        assigned_to: "adjudicator-2",
        approved_by: "owner-1",
        status: "approved",
      },
    ];

    expect(
      outstandingAssignedFinalComments(feedback, adjudicatorId),
    ).toHaveLength(1);
    expect(
      canCompleteAdjudication({
        adjudicatorUserId: adjudicatorId,
        feedback,
        scorecardStatus: "submitted",
      }),
    ).toBe(false);
  });

  it("requires the scorecard to be submitted even when comments are complete", () => {
    expect(
      canCompleteAdjudication({
        adjudicatorUserId: adjudicatorId,
        feedback: [
          {
            assigned_to: adjudicatorId,
            approved_by: adjudicatorId,
            status: "approved",
          },
        ],
        scorecardStatus: "draft",
      }),
    ).toBe(false);
  });
});
