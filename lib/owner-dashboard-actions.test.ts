import { describe, expect, it } from "vitest";

import {
  buildOwnerDashboardActions,
  type OwnerPostAdjudicationVisit,
} from "./owner-dashboard-actions";

function visit(
  overrides: Partial<OwnerPostAdjudicationVisit> = {},
): OwnerPostAdjudicationVisit {
  return {
    applicationId: "application-1",
    schoolName: "Blessed Trinity Catholic High School",
    productionTitle: "Finding Neverland",
    startsAt: "2026-11-07T23:00:00.000Z",
    endsAt: "2026-11-08T02:00:00.000Z",
    sectionCStageId: "section-c-stage",
    sectionCStarted: false,
    sectionCComplete: false,
    sectionCReminderSent: false,
    pickSixSent: false,
    panelCellsComplete: true,
    submittedScorecards: 2,
    expectedScorecards: 3,
    finalCommentsGenerated: false,
    schoolChatChannelId: "school-chat",
    ...overrides,
  };
}

describe("owner dashboard post-adjudication actions", () => {
  it("creates the four requested owner actions after an adjudication", () => {
    const actions = buildOwnerDashboardActions(
      [visit()],
      new Date("2026-11-08T03:00:00.000Z"),
    );

    expect(actions.map((action) => action.kind).sort()).toEqual([
      "final_comments",
      "pick_six",
      "section_c",
      "section_c_reminder",
    ]);
    expect(
      actions.find((action) => action.kind === "section_c")?.sectionCDueAt,
    ).toBe("2026-11-22T02:00:00.000Z");
    expect(
      actions.find((action) => action.kind === "pick_six")?.dueAt,
    ).toBe("2026-11-15T02:00:00.000Z");
    expect(
      actions.find((action) => action.kind === "section_c_reminder")?.href,
    ).toBe("/portal/chat?channel=school-chat");
  });

  it("waits to offer final-comment generation until every cell is complete", () => {
    const actions = buildOwnerDashboardActions(
      [visit({ panelCellsComplete: false })],
      new Date("2026-11-09T00:00:00.000Z"),
    );

    expect(actions.some((action) => action.kind === "final_comments")).toBe(false);
  });

  it("removes actions when their real workflow milestones are complete", () => {
    const actions = buildOwnerDashboardActions(
      [
        visit({
          sectionCStarted: true,
          sectionCComplete: true,
          sectionCReminderSent: true,
          pickSixSent: true,
          finalCommentsGenerated: true,
          submittedScorecards: 3,
        }),
      ],
      new Date("2026-11-20T00:00:00.000Z"),
    );

    expect(actions).toEqual([]);
  });

  it("does not show post-adjudication actions before the visit ends", () => {
    const actions = buildOwnerDashboardActions(
      [visit()],
      new Date("2026-11-08T01:00:00.000Z"),
    );

    expect(actions).toEqual([]);
  });
});
