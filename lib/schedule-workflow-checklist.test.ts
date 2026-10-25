import { describe, expect, it } from "vitest";

import {
  readScheduleWorkflowChecklist,
  resolveScheduleWorkflowChecklist,
  writeScheduleWorkflowChecklist,
} from "./schedule-workflow-checklist";

describe("schedule workflow checklist", () => {
  it("defaults every tracking step to incomplete", () => {
    expect(readScheduleWorkflowChecklist({})).toEqual({
      pick_six_sent: false,
      moved_to_section_c: false,
      section_c_complete: false,
      final_results_released: false,
    });
  });

  it("preserves application data while storing owner tracking", () => {
    const formData = writeScheduleWorkflowChecklist(
      { existing_answer: "keep me" },
      {
        pick_six_sent: true,
        moved_to_section_c: true,
        section_c_complete: false,
        final_results_released: false,
      },
      "owner-id",
    );

    expect(formData.existing_answer).toBe("keep me");
    expect(readScheduleWorkflowChecklist(formData)).toEqual({
      pick_six_sent: true,
      moved_to_section_c: true,
      section_c_complete: false,
      final_results_released: false,
    });
  });

  it("advances tracking from real release and Section C milestones", () => {
    expect(
      resolveScheduleWorkflowChecklist(
        {},
        {
          releasedFeedbackCount: 6,
          scoresReleased: true,
          sectionCStatus: "complete",
        },
      ),
    ).toEqual({
      pick_six_sent: true,
      moved_to_section_c: true,
      section_c_complete: true,
      final_results_released: true,
    });
  });

  it("keeps manual owner tracking while automatic milestones are pending", () => {
    expect(
      resolveScheduleWorkflowChecklist(
        {
          schedule_workflow_checklist: {
            pick_six_sent: true,
            moved_to_section_c: true,
          },
        },
        {
          releasedFeedbackCount: 2,
          scoresReleased: false,
          sectionCStatus: "locked",
        },
      ),
    ).toEqual({
      pick_six_sent: true,
      moved_to_section_c: true,
      section_c_complete: false,
      final_results_released: false,
    });
  });
});
