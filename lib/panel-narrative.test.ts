import { describe, expect, it } from "vitest";

import {
  activePanelMemberUserIds,
  finalCommentsReadyAnnouncement,
  isAssignedPanelNarrativeReviewer,
  isPanelNarrativeApprovalComplete,
  panelNarrativeSourceAssignmentIds,
  resolveGeneratedNarrativeFinal,
  shouldRefreshGeneratedNarrative,
} from "./panel-narrative";
import { resolvePanelAveragePolicy } from "./panel-average-policy";

describe("Owner panel narrative generation", () => {
  it("updates an untouched Owner draft automatically", () => {
    expect(
      resolveGeneratedNarrativeFinal({
        currentGeneratedComment: "Earlier generated draft",
        currentFinalComment: "Earlier generated draft",
        nextGeneratedComment: "Updated generated draft",
      }),
    ).toEqual({
      finalComment: "Updated generated draft",
      preservedOwnerDraft: false,
    });
  });

  it("refreshes the generated suggestion without overwriting an Owner edit", () => {
    expect(
      resolveGeneratedNarrativeFinal({
        currentGeneratedComment: "Earlier generated draft",
        currentFinalComment: "Owner edited draft",
        nextGeneratedComment: "Updated generated draft",
      }),
    ).toEqual({
      finalComment: "Owner edited draft",
      preservedOwnerDraft: true,
    });
  });

  it("lets the manual button replace an Owner edit", () => {
    expect(
      resolveGeneratedNarrativeFinal({
        currentGeneratedComment: "Earlier generated draft",
        currentFinalComment: "Owner edited draft",
        nextGeneratedComment: "Manually refreshed draft",
        replaceOwnerDraft: true,
      }),
    ).toEqual({
      finalComment: "Manually refreshed draft",
      preservedOwnerDraft: false,
    });
  });

  it("refreshes when live notes are newer even if an Owner draft exists", () => {
    expect(
      shouldRefreshGeneratedNarrative({
        status: "generated",
        generatedAt: "2026-09-20T22:17:51.810Z",
        latestSourceUpdate: Date.parse("2026-09-20T23:33:19.189Z"),
        now: Date.parse("2026-09-20T23:35:00.000Z"),
        cooldownMs: 90_000,
      }),
    ).toBe(true);
  });

  it("uses notes only from active assignments with commenting enabled", () => {
    expect(
      [...panelNarrativeSourceAssignmentIds([
        {
          id: "active-commenter",
          adjudicator_user_id: "adj-1",
          can_comment: true,
          removed_at: null,
        },
        {
          id: "scoring-only",
          adjudicator_user_id: "adj-2",
          can_comment: false,
          removed_at: null,
        },
        {
          id: "removed-commenter",
          adjudicator_user_id: "adj-3",
          can_comment: true,
          removed_at: "2026-10-20T18:00:00.000Z",
        },
        {
          id: "legacy-without-permission",
          adjudicator_user_id: "adj-4",
          removed_at: null,
        },
      ], new Set(["adj-1", "adj-2", "adj-3", "adj-4"]))],
    ).toEqual(["active-commenter"]);
  });

  it("excludes comment-enabled assignments outside the scoring contributor panel", () => {
    expect(
      [...panelNarrativeSourceAssignmentIds([
        {
          id: "adjudicator-assignment",
          adjudicator_user_id: "adj-1",
          can_comment: true,
          removed_at: null,
        },
        {
          id: "acm-assignment",
          adjudicator_user_id: "acm-1",
          can_comment: true,
          removed_at: null,
        },
      ], new Set(["adj-1"]))],
    ).toEqual(["adjudicator-assignment"]);
  });

  it("uses only the three adjudicators for narratives when an ACM is also scoring", () => {
    const assignments = [
      {
        id: "assignment-adj-1",
        adjudicator_user_id: "adj-1",
        participant_role: "adjudicator" as const,
        can_score: true,
        can_comment: true,
        removed_at: null,
      },
      {
        id: "assignment-adj-2",
        adjudicator_user_id: "adj-2",
        participant_role: "adjudicator" as const,
        can_score: true,
        can_comment: true,
        removed_at: null,
      },
      {
        id: "assignment-adj-3",
        adjudicator_user_id: "adj-3",
        participant_role: "adjudicator" as const,
        can_score: true,
        can_comment: true,
        removed_at: null,
      },
      {
        id: "assignment-acm",
        adjudicator_user_id: "acm-1",
        participant_role: "advisory_member" as const,
        can_score: true,
        can_comment: true,
        removed_at: null,
      },
    ];
    const policy = resolvePanelAveragePolicy(assignments, [
      { id: "adj-1", role: "adjudicator" },
      { id: "adj-2", role: "adjudicator" },
      { id: "adj-3", role: "adjudicator" },
      { id: "acm-1", role: "advisory_member" },
    ]);

    expect([
      ...panelNarrativeSourceAssignmentIds(
        assignments,
        policy.contributorUserIds,
      ),
    ]).toEqual([
      "assignment-adj-1",
      "assignment-adj-2",
      "assignment-adj-3",
    ]);
  });

  it("only lets the assigned panel member approve a final comment", () => {
    expect(
      isAssignedPanelNarrativeReviewer({
        assignedTo: "panelist-1",
        reviewerId: "panelist-1",
      }),
    ).toBe(true);
    expect(
      isAssignedPanelNarrativeReviewer({
        assignedTo: "panelist-1",
        reviewerId: "panelist-2",
      }),
    ).toBe(false);
    expect(
      isAssignedPanelNarrativeReviewer({
        assignedTo: null,
        reviewerId: "panelist-1",
      }),
    ).toBe(false);
  });

  it("shares released final comments with every active scoring or commenting panel member", () => {
    expect(
      activePanelMemberUserIds([
        {
          adjudicator_user_id: "scorer-only",
          can_score: true,
          can_comment: false,
          removed_at: null,
        },
        {
          adjudicator_user_id: "commenter-only",
          can_score: false,
          can_comment: true,
          removed_at: null,
        },
        {
          adjudicator_user_id: "both",
          can_score: true,
          can_comment: true,
          removed_at: null,
        },
        {
          adjudicator_user_id: "observer",
          can_score: false,
          can_comment: false,
          removed_at: null,
        },
        {
          adjudicator_user_id: "removed",
          can_score: true,
          can_comment: true,
          removed_at: "2026-11-10T12:00:00.000Z",
        },
        {
          adjudicator_user_id: "both",
          can_score: true,
          can_comment: true,
          removed_at: null,
        },
      ]),
    ).toEqual(["scorer-only", "commenter-only", "both"]);
  });

  it("announces Owner-sent comments and explains panel access", () => {
    expect(
      finalCommentsReadyAnnouncement({
        schoolName: "Demo School",
        productionTitle: "Newsies",
        categoryTitles: ["Direction", "Technical Execution"],
      }),
    ).toBe(
      "The Owner sent final comments to the panel for Demo School — Newsies.\n\n" +
        "2 final comments are ready for panel review.\n" +
        "• Direction\n" +
        "• Technical Execution\n\n" +
        "All active panel members can read the comments. Only each assigned writer can edit and approve their comment.",
    );
  });

  it("requires approval from the assigned active panel reviewer", () => {
    const panelReviewerIds = new Set(["panelist-1", "panelist-2"]);

    expect(
      isPanelNarrativeApprovalComplete({
        assignedTo: "panelist-1",
        approvedBy: "panelist-1",
        panelReviewerIds,
      }),
    ).toBe(true);
    expect(
      isPanelNarrativeApprovalComplete({
        assignedTo: "panelist-1",
        approvedBy: "panelist-2",
        panelReviewerIds,
      }),
    ).toBe(false);
  });
});
