import { describe, expect, it } from "vitest";

import {
  buildAdjudicationReleaseAnnouncement,
  mergeReleasedFeedback,
  PICK_SIX_RELEASE_MESSAGE,
  updateSelectedCategoryIds,
} from "@/lib/adjudication-release";
import type { ReleasedFeedbackSummary } from "@/lib/types";

function feedback(
  categoryId: string,
  sortOrder: number,
  finalComment: string,
): ReleasedFeedbackSummary {
  return {
    category_id: categoryId,
    final_comment: finalComment,
    sort_order: sortOrder,
    title: `Category ${sortOrder}`,
  };
}

describe("mergeReleasedFeedback", () => {
  it("retains earlier releases and adds newly selected comments in rubric order", () => {
    expect(
      mergeReleasedFeedback(
        [feedback("category-3", 3, "Third")],
        [feedback("category-1", 1, "First")],
      ),
    ).toEqual([
      feedback("category-1", 1, "First"),
      feedback("category-3", 3, "Third"),
    ]);
  });

  it("replaces a previously released category without duplicating it", () => {
    expect(
      mergeReleasedFeedback(
        [
          feedback("category-1", 1, "Old first"),
          feedback("category-2", 2, "Second"),
        ],
        [feedback("category-1", 1, "Updated first")],
      ),
    ).toEqual([
      feedback("category-1", 1, "Updated first"),
      feedback("category-2", 2, "Second"),
    ]);
  });
});

describe("updateSelectedCategoryIds", () => {
  it("adds the checked category without mutating the prior selection", () => {
    const current = new Set(["category-1"]);
    const next = updateSelectedCategoryIds(current, "category-2", true);

    expect([...current]).toEqual(["category-1"]);
    expect([...next]).toEqual(["category-1", "category-2"]);
  });

  it("removes an unchecked category while preserving other selections", () => {
    const current = new Set(["category-1", "category-2"]);

    expect([
      ...updateSelectedCategoryIds(current, "category-1", false),
    ]).toEqual(["category-2"]);
  });
});

describe("buildAdjudicationReleaseAnnouncement", () => {
  it("uses the director-facing Pick 6 letter when exactly six comments are released without scores", () => {
    expect(
      buildAdjudicationReleaseAnnouncement({
        schoolName: "Demo School",
        productionTitle: "Newsies",
        releaseScores: false,
        releaseComments: true,
        releasedCommentTitles: [
          "Music Direction",
          "Choreography",
          "Lighting Design",
          "Sound Design",
          "Scenic",
          "Direction",
        ],
      }),
    ).toEqual({
      subject: "Your Pick 6 Report is ready",
      body: PICK_SIX_RELEASE_MESSAGE,
    });
  });

  it("describes a selected comment release without implying scores were released", () => {
    expect(
      buildAdjudicationReleaseAnnouncement({
        schoolName: "Demo School",
        productionTitle: "Newsies",
        releaseScores: false,
        releaseComments: true,
        releasedCommentTitles: ["Music Direction", "Choreography"],
      }),
    ).toEqual({
      subject: "Adjudication comments released",
      body: "GHSMTA has released adjudication comments for Demo School — Newsies.\n\nReleased comments: Music Direction, Choreography.\n\nOpen Results in the portal to review what is now available.",
    });
  });

  it("announces scores and comments together", () => {
    const announcement = buildAdjudicationReleaseAnnouncement({
      schoolName: "Demo School",
      productionTitle: null,
      releaseScores: true,
      releaseComments: true,
      releasedCommentTitles: ["Music Direction"],
    });

    expect(announcement.subject).toBe(
      "Adjudication scores and comments released",
    );
    expect(announcement.body).toContain("Demo School — Untitled production");
  });

  it("announces a scores-only release", () => {
    expect(
      buildAdjudicationReleaseAnnouncement({
        schoolName: "Demo School",
        productionTitle: "Newsies",
        releaseScores: true,
        releaseComments: false,
      }).subject,
    ).toBe("Adjudication scores released");
  });
});
