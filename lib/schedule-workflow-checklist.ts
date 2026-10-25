export const SCHEDULE_WORKFLOW_CHECKLIST_KEY = "schedule_workflow_checklist";

export const SCHEDULE_WORKFLOW_CHECKLIST_FIELDS = [
  "pick_six_sent",
  "moved_to_section_c",
  "section_c_complete",
  "final_results_released",
] as const;

export type ScheduleWorkflowChecklistField =
  (typeof SCHEDULE_WORKFLOW_CHECKLIST_FIELDS)[number];

export type ScheduleWorkflowChecklist = Record<
  ScheduleWorkflowChecklistField,
  boolean
>;

export type ScheduleWorkflowMilestones = {
  releasedFeedbackCount?: number | null;
  scoresReleased?: boolean | null;
  sectionCStatus?: string | null;
};

export const EMPTY_SCHEDULE_WORKFLOW_CHECKLIST: ScheduleWorkflowChecklist = {
  pick_six_sent: false,
  moved_to_section_c: false,
  section_c_complete: false,
  final_results_released: false,
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
    section_c_complete: stored.section_c_complete === true,
    final_results_released: stored.final_results_released === true,
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
    section_c_complete:
      stored.section_c_complete || sectionCStatus === "complete",
    final_results_released:
      stored.final_results_released || milestones.scoresReleased === true,
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
      ...checklist,
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    },
  };
}
