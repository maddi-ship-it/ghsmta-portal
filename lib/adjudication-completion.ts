type AssignedFinalComment = {
  assigned_to: string | null;
  approved_by: string | null;
  status: string;
};

export function outstandingAssignedFinalComments(
  feedback: AssignedFinalComment[],
  adjudicatorUserId: string,
) {
  return feedback.filter(
    (comment) =>
      comment.assigned_to === adjudicatorUserId &&
      !(
        comment.status === "approved" &&
        comment.approved_by === adjudicatorUserId
      ),
  );
}

export function canCompleteAdjudication({
  feedback,
  adjudicatorUserId,
  scorecardStatus,
}: {
  feedback: AssignedFinalComment[];
  adjudicatorUserId: string;
  scorecardStatus: string | null | undefined;
}) {
  return (
    ["submitted", "locked"].includes(scorecardStatus ?? "") &&
    outstandingAssignedFinalComments(feedback, adjudicatorUserId).length === 0
  );
}
