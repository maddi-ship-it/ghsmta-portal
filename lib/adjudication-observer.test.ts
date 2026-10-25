import { describe, expect, it } from "vitest";

import { buildAdjudicationObserverPanelRows } from "./adjudication-observer";

describe("buildAdjudicationObserverPanelRows", () => {
  it("keeps active panel order and includes members who have not written yet", () => {
    const rows = buildAdjudicationObserverPanelRows({
      assignments: [
        {
          id: "assignment-1",
          adjudicator_user_id: "user-1",
          assigned_at: "2026-10-25T10:00:00.000Z",
          can_score: true,
          can_comment: true,
        },
        {
          id: "assignment-2",
          adjudicator_user_id: "user-2",
          assigned_at: "2026-10-25T11:00:00.000Z",
          can_score: true,
          can_comment: true,
        },
      ],
      profiles: [
        { id: "user-1", full_name: "First Reviewer" },
        { id: "user-2", full_name: "Second Reviewer" },
      ],
      scorecards: [
        { id: "scorecard-1", adjudicator_user_id: "user-1" },
        { id: "scorecard-2", adjudicator_user_id: "user-2" },
      ],
      scores: [
        {
          scorecard_id: "scorecard-1",
          criterion_id: "criterion-1",
          observation: "Visible live note",
          updated_at: "2026-10-25T12:00:00.000Z",
        },
      ],
    });

    expect(rows).toEqual([
      {
        panel_order: 1,
        adjudicator_user_id: "user-1",
        adjudicator_name: "First Reviewer",
        criterion_id: "criterion-1",
        observation: "Visible live note",
        updated_at: "2026-10-25T12:00:00.000Z",
      },
      {
        panel_order: 2,
        adjudicator_user_id: "user-2",
        adjudicator_name: "Second Reviewer",
        criterion_id: null,
        observation: null,
        updated_at: null,
      },
    ]);
  });

  it("uses an anonymous panel label when a profile has no display name", () => {
    const rows = buildAdjudicationObserverPanelRows({
      assignments: [
        {
          id: "assignment-1",
          adjudicator_user_id: "user-1",
          assigned_at: "2026-10-25T10:00:00.000Z",
          can_score: true,
          can_comment: false,
        },
      ],
      profiles: [{ id: "user-1", full_name: "  " }],
      scorecards: [],
      scores: [],
    });

    expect(rows[0]?.adjudicator_name).toBe("Adjudicator 1");
  });
});
