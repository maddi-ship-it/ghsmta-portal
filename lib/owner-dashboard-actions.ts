const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export type OwnerPostAdjudicationVisit = {
  applicationId: string;
  schoolName: string;
  productionTitle: string | null;
  startsAt: string;
  endsAt: string;
  sectionCStageId: string | null;
  sectionCStarted: boolean;
  sectionCComplete: boolean;
  sectionCReminderSent: boolean;
  pickSixSent: boolean;
  panelCellsComplete: boolean;
  submittedScorecards: number;
  expectedScorecards: number;
  finalCommentsGenerated: boolean;
  schoolChatChannelId: string | null;
};

export type OwnerDashboardActionKind =
  | "section_c"
  | "final_comments"
  | "pick_six"
  | "section_c_reminder";

export type OwnerDashboardAction = {
  id: string;
  kind: OwnerDashboardActionKind;
  applicationId: string;
  schoolName: string;
  productionTitle: string | null;
  title: string;
  detail: string;
  dueAt: string;
  sectionCDueAt: string;
  href: string;
  canMarkReminderSent: boolean;
  timing: "ready" | "upcoming" | "overdue";
};

type OwnerDashboardActionDraft = Omit<OwnerDashboardAction, "timing">;

function addDays(value: string, days: number) {
  return new Date(new Date(value).getTime() + days * DAY_IN_MILLISECONDS).toISOString();
}

export function buildOwnerDashboardActions(
  visits: OwnerPostAdjudicationVisit[],
  now = new Date(),
): OwnerDashboardAction[] {
  const actions: OwnerDashboardActionDraft[] = [];

  for (const visit of visits) {
    const visitEnd = new Date(visit.endsAt);
    if (Number.isNaN(visitEnd.getTime()) || visitEnd.getTime() > now.getTime()) {
      continue;
    }

    const sectionCDueAt = addDays(visit.endsAt, 14);
    const oneWeekAfterVisit = addDays(visit.endsAt, 7);
    const applicationLabel = visit.productionTitle?.trim() || "Production";

    if (!visit.sectionCStarted) {
      actions.push({
        id: `${visit.applicationId}:section-c`,
        kind: "section_c",
        applicationId: visit.applicationId,
        schoolName: visit.schoolName,
        productionTitle: visit.productionTitle,
        title: "Move the school to Section C",
        detail: `${applicationLabel} must be manually advanced. Section C is due 14 days after the adjudication.`,
        dueAt: visit.endsAt,
        sectionCDueAt,
        href: visit.sectionCStageId
          ? `/portal/applications/${visit.applicationId}?stage=${visit.sectionCStageId}&owner_tools=1#owner-application-tools`
          : `/portal/applications/${visit.applicationId}?owner_tools=1#owner-application-tools`,
        canMarkReminderSent: false,
      });
    }

    if (visit.panelCellsComplete && !visit.finalCommentsGenerated) {
      const submissionDetail =
        visit.expectedScorecards > 0 &&
        visit.submittedScorecards === visit.expectedScorecards
          ? "All scorecards are submitted."
          : `${visit.submittedScorecards} of ${visit.expectedScorecards} scorecards are submitted; all required cells are complete.`;
      actions.push({
        id: `${visit.applicationId}:final-comments`,
        kind: "final_comments",
        applicationId: visit.applicationId,
        schoolName: visit.schoolName,
        productionTitle: visit.productionTitle,
        title: "Generate final comments",
        detail: `${submissionDetail} Generate the Owner drafts for adjudication review.`,
        dueAt: visit.endsAt,
        sectionCDueAt,
        href: `/portal/adjudication/${visit.applicationId}#owner-comment-review`,
        canMarkReminderSent: false,
      });
    }

    if (!visit.pickSixSent) {
      actions.push({
        id: `${visit.applicationId}:pick-six`,
        kind: "pick_six",
        applicationId: visit.applicationId,
        schoolName: visit.schoolName,
        productionTitle: visit.productionTitle,
        title: "Send the Pick 6",
        detail: "Release the school’s six selected early-feedback comments within one week of adjudication.",
        dueAt: oneWeekAfterVisit,
        sectionCDueAt,
        href: `/portal/adjudication/${visit.applicationId}#owner-comment-review`,
        canMarkReminderSent: false,
      });
    }

    if (!visit.sectionCReminderSent && !visit.sectionCComplete) {
      actions.push({
        id: `${visit.applicationId}:section-c-reminder`,
        kind: "section_c_reminder",
        applicationId: visit.applicationId,
        schoolName: visit.schoolName,
        productionTitle: visit.productionTitle,
        title: "Send the second Section C reminder",
        detail: "Remind the school of its Section C deadline one week before it is due.",
        dueAt: oneWeekAfterVisit,
        sectionCDueAt,
        href: visit.schoolChatChannelId
          ? `/portal/chat?channel=${visit.schoolChatChannelId}`
          : "/portal/chat",
        canMarkReminderSent: true,
      });
    }
  }

  return actions.map((action): OwnerDashboardAction => ({
    ...action,
    timing: ["section_c", "final_comments"].includes(action.kind)
      ? "ready"
      : new Date(action.dueAt).getTime() < now.getTime()
        ? "overdue"
        : "upcoming",
  })).sort((left, right) => {
    const dueDifference =
      new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime();
    return (
      dueDifference ||
      left.schoolName.localeCompare(right.schoolName) ||
      left.kind.localeCompare(right.kind)
    );
  });
}
