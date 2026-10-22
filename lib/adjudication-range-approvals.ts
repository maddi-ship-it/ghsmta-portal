export type RangeApprovalReviewer = {
  id: string;
  name: string;
  role: "adjudicator" | "advisory_member";
  active: boolean;
};

export type RangeApprovalRecord = {
  proposal_id: string;
  adjudicator_user_id: string;
  response: string;
  comment: string | null;
};

export type RangeApprovalRosterEntry = RangeApprovalReviewer & {
  status: "approved" | "disputed" | "awaiting" | "not_sent";
  comment: string | null;
};

export function buildRangeApprovalRoster({
  approvals,
  proposalId,
  proposalStatus,
  reviewers,
}: {
  approvals: RangeApprovalRecord[];
  proposalId: string | null;
  proposalStatus: string | null;
  reviewers: RangeApprovalReviewer[];
}): RangeApprovalRosterEntry[] {
  const hasBeenSent = Boolean(proposalId) && proposalStatus !== "draft";
  const approvalByReviewer = new Map(
    approvals
      .filter((approval) => approval.proposal_id === proposalId)
      .map((approval) => [approval.adjudicator_user_id, approval]),
  );

  return reviewers.map((reviewer) => {
    const approval = approvalByReviewer.get(reviewer.id);
    const status = !hasBeenSent
      ? "not_sent"
      : approval?.response === "approved"
        ? "approved"
        : approval?.response === "disputed"
          ? "disputed"
          : "awaiting";

    return {
      ...reviewer,
      status,
      comment: approval?.comment ?? null,
    };
  });
}
