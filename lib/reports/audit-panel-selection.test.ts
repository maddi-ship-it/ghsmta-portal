import { describe, expect, it } from "vitest";

import { selectAuditPanelAssignments } from "./audit-panel-selection";

describe("selectAuditPanelAssignments", () => {
  it("keeps a removed adjudicator with completed scores and excludes the advisory reference", () => {
    const assignments = [
      {
        id: "julie-assignment",
        adjudicator_user_id: "julie",
        participant_role: "adjudicator",
        can_score: true,
        removed_at: null,
      },
      {
        id: "amy-assignment",
        adjudicator_user_id: "amy",
        participant_role: "adjudicator",
        can_score: true,
        removed_at: "2026-10-26T00:53:49.804Z",
      },
      {
        id: "john-assignment",
        adjudicator_user_id: "john",
        participant_role: "adjudicator",
        can_score: true,
        removed_at: null,
      },
      {
        id: "beth-assignment",
        adjudicator_user_id: "beth",
        participant_role: "advisory_member",
        can_score: true,
        removed_at: null,
      },
      {
        id: "monica-assignment",
        adjudicator_user_id: "monica",
        participant_role: "adjudicator",
        can_score: false,
        removed_at: "2026-10-15T13:40:36.029Z",
      },
    ];
    const scorecards = assignments.map((assignment) => ({
      id: `${assignment.adjudicator_user_id}-card`,
      assignment_id: assignment.id,
      status: assignment.adjudicator_user_id === "amy" ? "locked" : "draft",
      submitted_at:
        assignment.adjudicator_user_id === "amy"
          ? "2026-10-26T00:53:39.822Z"
          : null,
    }));
    const scoreCountByScorecardId = new Map([
      ["julie-card", 55],
      ["amy-card", 55],
      ["john-card", 55],
      ["beth-card", 55],
      ["monica-card", 0],
    ]);
    const profileRoleByUserId = new Map([
      ["julie", "adjudicator"],
      ["amy", "advisory_member"],
      ["john", "adjudicator"],
      ["beth", "adjudicator"],
      ["monica", "adjudicator"],
    ]);

    expect(
      selectAuditPanelAssignments({
        assignments,
        scorecards,
        scoreCountByScorecardId,
        profileRoleByUserId,
      }).map((assignment) => assignment.adjudicator_user_id),
    ).toEqual(["julie", "amy", "john"]);
  });

  it("uses the advisory scorer when fewer than three adjudicators contributed", () => {
    const assignments = [
      {
        id: "one-assignment",
        adjudicator_user_id: "one",
        participant_role: "adjudicator",
        can_score: true,
        removed_at: null,
      },
      {
        id: "two-assignment",
        adjudicator_user_id: "two",
        participant_role: "adjudicator",
        can_score: true,
        removed_at: null,
      },
      {
        id: "advisory-assignment",
        adjudicator_user_id: "advisory",
        participant_role: "advisory_member",
        can_score: true,
        removed_at: null,
      },
    ];

    expect(
      selectAuditPanelAssignments({
        assignments,
        scorecards: [],
        scoreCountByScorecardId: new Map(),
        profileRoleByUserId: new Map(),
      }).map((assignment) => assignment.adjudicator_user_id),
    ).toEqual(["one", "two", "advisory"]);
  });
});
