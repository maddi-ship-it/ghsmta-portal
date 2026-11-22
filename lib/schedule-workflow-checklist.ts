export const SCHEDULE_WORKFLOW_CHECKLIST_KEY = "schedule_workflow_checklist";

export const SCHEDULE_WORKFLOW_CHECKLIST_FIELDS = [
  "pick_six_sent",
  "moved_to_section_c",
  "section_c_reminder_sent",
  "section_c_complete",
  "final_results_released",
] as const;

export const SCHEDULE_WORKFLOW_AUTOMATED_FIELDS = [
  "comments_sent_to_adjudicators",
  "all_comments_reviewed_and_approved",
] as const;

export type ScheduleWorkflowManualChecklistField =
  (typeof SCHEDULE_WORKFLOW_CHECKLIST_FIELDS)[number];
export type ScheduleWorkflowAutomatedChecklistField =
  (typeof SCHEDULE_WORKFLOW_AUTOMATED_FIELDS)[number];
export type ScheduleWorkflowChecklistField =
  | ScheduleWorkflowManualChecklistField
  | ScheduleWorkflowAutomatedChecklistField;

export type ScheduleWorkflowChecklist = Record<
  ScheduleWorkflowChecklistField,
  boolean
>;

export type ScheduleWorkflowMilestones = {
  releasedFeedbackCount?: number | null;
  scoresReleased?: boolean | null;
  sectionCStatus?: string | null;
  commentsSentToAdjudicators?: boolean | null;
  allCommentsReviewedAndApproved?: boolean | null;
};

export const EMPTY_SCHEDULE_WORKFLOW_CHECKLIST: ScheduleWorkflowChecklist = {
  pick_six_sent: false,
  moved_to_section_c: false,
  section_c_reminder_sent: false,
  section_c_complete: false,
  final_results_released: false,
  comments_sent_to_adjudicators: false,
  all_comments_reviewed_and_approved: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readScheduleWorkflowChecklist(
  formData: Record<string, unknown> | null | undefined,
): ScheduleWorkflowChecklist {
  const stored = isRecord(formData?.[SCHEDULE_WORKFLOW_CHECKLIST_KEY])
    ? formData[SCHEDULE_WORKFLOW_CHECKLIST_KEY]
    : {};

  return {
    pick_six_sent: stored.pick_six_sent === true,
    moved_to_section_c: stored.moved_to_section_c === true,
    section_c_reminder_sent: stored.section_c_reminder_sent === true,
    section_c_complete: stored.section_c_complete === true,
    final_results_released: stored.final_results_released === true,
    comments_sent_to_adjudicators: false,
    all_comments_reviewed_and_approved: false,
  };
}

export function resolveScheduleWorkflowChecklist(
  formData: Record<string, unknown> | null | undefined,
  milestones: ScheduleWorkflowMilestones = {},
): ScheduleWorkflowChecklist {
  const stored = readScheduleWorkflowChecklist(formData);
  const sectionCStatus = String(milestones.sectionCStatus ?? "")
    .trim()
    .toLowerCase();
  const sectionCStarted = Boolean(sectionCStatus) && sectionCStatus !== "locked";

  return {
    pick_six_sent:
      stored.pick_six_sent ||
      Number(milestones.releasedFeedbackCount ?? 0) >= 6,
    moved_to_section_c: stored.moved_to_section_c || sectionCStarted,
    section_c_reminder_sent: stored.section_c_reminder_sent,
    section_c_complete:
      stored.section_c_complete || sectionCStatus === "complete",
    final_results_released:
      stored.final_results_released || milestones.scoresReleased === true,
    comments_sent_to_adjudicators:
      milestones.commentsSentToAdjudicators === true,
    all_comments_reviewed_and_approved:
      milestones.allCommentsReviewedAndApproved === true,
  };
}

export function writeScheduleWorkflowChecklist(
  formData: Record<string, unknown> | null | undefined,
  checklist: ScheduleWorkflowChecklist,
  actorId: string,
): Record<string, unknown> {
  return {
    ...(formData ?? {}),
    [SCHEDULE_WORKFLOW_CHECKLIST_KEY]: {
      pick_six_sent: checklist.pick_six_sent,
      moved_to_section_c: checklist.moved_to_section_c,
      section_c_reminder_sent: checklist.section_c_reminder_sent,
      section_c_complete: checklist.section_c_complete,
      final_results_released: checklist.final_results_released,
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    },
  };
}
