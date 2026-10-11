import { completeAdjudication } from "@/app/portal/adjudication/[id]/actions";

export function CompleteAdjudicationControl({
  applicationId,
  outstandingCommentCount,
}: {
  applicationId: string;
  outstandingCommentCount: number;
}) {
  const canComplete = outstandingCommentCount === 0;
  const helpMessage = canComplete
    ? "All assigned final comments have been returned to the Owners. Completing adjudication removes your access to this school."
    : `Return ${outstandingCommentCount} assigned final comment${
        outstandingCommentCount === 1 ? "" : "s"
      } to the Owners before completing adjudication.`;

  return (
    <form
      action={completeAdjudication.bind(null, applicationId)}
      className="scorecard-submit-control scorecard-submit-control-compact"
      data-tooltip={!canComplete ? helpMessage : undefined}
      tabIndex={!canComplete ? 0 : undefined}
    >
      <button
        aria-label={helpMessage}
        className="application-reference-button application-reference-submit-button application-reference-complete-button"
        disabled={!canComplete}
        type="submit"
      >
        Complete adjudication
      </button>
    </form>
  );
}
