import { describe, expect, it } from "vitest";

import {
  panelNarrativeDraftHasNewerServerVersion,
  rebasePanelNarrativeLocalDraft,
  resolvePanelNarrativeDraftApproval,
} from "./panel-narrative-local-draft";

describe("panel narrative local draft recovery", () => {
  it("detects when a live narrative regenerated after the local draft began", () => {
    expect(
      panelNarrativeDraftHasNewerServerVersion({
        draftSourceGeneratedAt: "2026-11-15T01:02:14.065Z",
        latestSourceGeneratedAt: "2026-11-15T01:37:49.041Z",
      }),
    ).toBe(true);

    expect(
      panelNarrativeDraftHasNewerServerVersion({
        draftSourceGeneratedAt: "2026-11-15T01:37:49.041Z",
        latestSourceGeneratedAt: "2026-11-15T01:37:49.041Z",
      }),
    ).toBe(false);
  });

  it("rebases only the version metadata while preserving the Owner's text", () => {
    expect(
      rebasePanelNarrativeLocalDraft({
        draft: {
          finalComment: "Owner edited narrative",
          approved: true,
          sourceGeneratedAt: "old-version",
        },
        latestSourceGeneratedAt: "new-version",
        savedAt: "2026-11-15T02:00:00.000Z",
      }),
    ).toEqual({
      finalComment: "Owner edited narrative",
      approved: true,
      sourceGeneratedAt: "new-version",
      savedAt: "2026-11-15T02:00:00.000Z",
    });
  });

  it("preserves panel approval while the Owner edits the narrative text", () => {
    expect(
      resolvePanelNarrativeDraftApproval({
        existingDraftApprovalChanged: undefined,
        existingDraftApproved: undefined,
        nextApproved: undefined,
        serverApproved: true,
      }),
    ).toBe(true);

    expect(
      resolvePanelNarrativeDraftApproval({
        existingDraftApprovalChanged: undefined,
        existingDraftApproved: true,
        nextApproved: undefined,
        serverApproved: false,
      }),
    ).toBe(true);
  });

  it("honors an explicit Owner approval change", () => {
    expect(
      resolvePanelNarrativeDraftApproval({
        existingDraftApprovalChanged: true,
        existingDraftApproved: true,
        nextApproved: false,
        serverApproved: true,
      }),
    ).toBe(false);
  });

  it("repairs a legacy local draft that accidentally dropped server approval", () => {
    expect(
      resolvePanelNarrativeDraftApproval({
        existingDraftApprovalChanged: undefined,
        existingDraftApproved: false,
        nextApproved: undefined,
        serverApproved: true,
      }),
    ).toBe(true);
  });
});
