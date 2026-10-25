import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type {
  AdjudicationRelease,
  Application,
  AwardCycle,
} from "@/lib/types";

import { buildReleasedResultsPdf } from "./released-results-pdf";

const application = {
  school_name: "Demo School",
  production_title: "Newsies",
} as Application;

const cycle = {
  season_year: "2026-2027",
  name: "Director Application",
} as AwardCycle;

function releaseWithFeedback(): AdjudicationRelease {
  return {
    id: "release-1",
    application_id: "application-1",
    scores_released_at: null,
    feedback_released_at: "2026-10-25T16:00:00.000Z",
    score_snapshot: [],
    feedback_snapshot: [
      {
        category_id: "music",
        title: "Music Direction",
        sort_order: 1,
        final_comment: "A focused and specific music direction comment.",
      },
      {
        category_id: "choreography",
        title: "Choreography",
        sort_order: 2,
        final_comment: "A focused and specific choreography comment.",
      },
    ],
    release_notes: null,
    released_by: null,
    created_at: "2026-10-25T16:00:00.000Z",
    updated_at: "2026-10-25T16:00:00.000Z",
  };
}

describe("buildReleasedResultsPdf", () => {
  it("starts each released comment category on its own page", async () => {
    const bytes = await buildReleasedResultsPdf({
      application,
      cycle,
      release: releaseWithFeedback(),
    });
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getPageCount()).toBe(2);
  });

  it("starts feedback on a new page after released scores", async () => {
    const release = releaseWithFeedback();
    release.scores_released_at = "2026-10-25T16:00:00.000Z";
    release.score_snapshot = [
      {
        category_id: "music",
        title: "Music Direction",
        sort_order: 1,
        average_score: 8.25,
        score_count: 3,
      },
    ];

    const bytes = await buildReleasedResultsPdf({
      application,
      cycle,
      release,
    });
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getPageCount()).toBe(3);
  });
});
