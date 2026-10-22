import { describe, expect, it } from "vitest";

import {
  buildRangeApprovalRoster,
  type RangeApprovalReviewer,
} from "@/lib/adjudication-range-approvals";

const reviewers: RangeApprovalReviewer[] = [
  {
    id: "reviewer-one",
    name: "First Reviewer",
    role: "adjudicator",
    active: true,
  },
  {
    id: "reviewer-two",
    name: "Second Reviewer",
    role: "adjudicator",
    active: true,
  },
];

describe("two-point range approval roster", () => {
  it("marks every reviewer as not sent while a category decision is a draft", () => {
    const roster = buildRangeApprovalRoster({
      approvals: [],
      proposalId: "proposal-one",
      proposalStatus: "draft",
      reviewers,
    });

    expect(roster.map((entry) => entry.status)).toEqual([
      "not_sent",
      "not_sent",
    ]);
  });

  it("shows approved, disputed, and awaiting reviewers independently", () => {
    const roster = buildRangeApprovalRoster({
      approvals: [
        {
          proposal_id: "proposal-one",
          adjudicator_user_id: "reviewer-one",
          response: "approved",
          comment: null,
        },
      ],
      proposalId: "proposal-one",
      proposalStatus: "proposed",
      reviewers,
    });

    expect(roster.map((entry) => entry.status)).toEqual([
      "approved",
      "awaiting",
    ]);

    const disputedRoster = buildRangeApprovalRoster({
      approvals: [
        {
          proposal_id: "proposal-one",
          adjudicator_user_id: "reviewer-two",
          response: "disputed",
          comment: "Please revisit the upper bound.",
        },
      ],
      proposalId: "proposal-one",
      proposalStatus: "disputed",
      reviewers,
    });

    expect(disputedRoster[1]).toMatchObject({
      status: "disputed",
      comment: "Please revisit the upper bound.",
    });
  });
});
