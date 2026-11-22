import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApplicationReferenceBar } from "./application-reference-bar";

const panels = [
  ["eligibility", "ELIGIBILITY"],
  ["acting-candidates", "ACTING CANDIDATES"],
  ["musical-budget", "BUDGET"],
  ["program-vision", "PROGRAM MATURITY, VISION, SUPPORT VIEW"],
  ["full-application", "FULL APPLICATION"],
].map(([key, shortTitle]) => ({
  key,
  shortTitle,
  title: shortTitle,
  description: "",
  groups: [],
}));

describe("ApplicationReferenceBar", () => {
  it("groups the Owner review controls in the top header without Panel review", () => {
    const html = renderToStaticMarkup(
      <ApplicationReferenceBar
        categoryNavigation={{
          categories: [{ id: "direction", title: "Direction" }],
          showCompletion: false,
        }}
        panels={panels}
        reviewActions={{
          showCategoryReview: true,
          showPanelReview: false,
        }}
        showFullScoreView
        showOwnerCommentReview
      />,
    );

    const reviewCategories = html.indexOf("Review all categories");
    const reviewComments = html.indexOf("Review all comments");
    const fullScoreView = html.indexOf("Full score view");

    expect(reviewCategories).toBeGreaterThanOrEqual(0);
    expect(reviewComments).toBeGreaterThan(reviewCategories);
    expect(fullScoreView).toBeGreaterThan(reviewComments);
    expect(html).not.toContain("Panel review");
  });

  it("renders category navigation and adjudicator actions in the requested order", () => {
    const html = renderToStaticMarkup(
      <ApplicationReferenceBar
        categoryWorkflowControl={<span>SPECIALTY AWARDS</span>}
        categoryNavigation={{
          categories: [{ id: "direction", title: "Direction" }],
          initialCompletedCategoryIds: ["direction"],
          showCompletion: true,
        }}
        links={[
          {
            key: "scoring-guide",
            label: "Scoring guide",
            fileName: "guide.pdf",
            href: "https://example.com/guide.pdf",
          },
          {
            key: "evaluative-glossary",
            label: "Evaluative glossary",
            fileName: "glossary.pdf",
            href: "https://example.com/glossary.pdf",
          },
        ]}
        panels={panels}
        reviewActions={{
          categoryReviewStatus: "needs-action",
          showCategoryReview: true,
          showPanelReview: false,
        }}
        scorecardSubmitControl={<span>SUBMIT SCORECARD</span>}
        showFullScoreView
      />,
    );

    const controlLabels = [
      "CURRENT CATEGORY",
      "Review all categories",
      "SPECIALTY AWARDS",
      "Full score view",
      "SUBMIT SCORECARD",
      "ADJUDICATOR VIEWS",
      "ELIGIBILITY",
      "ACTING CANDIDATES",
      "BUDGET",
      "PROGRAM MATURITY, VISION, SUPPORT VIEW",
      "FULL APPLICATION",
      "SCORING TOOLS",
      "SCORING GUIDE",
      "EVALUTIVE GLOSSARY",
    ];
    const positions = controlLabels.map((label) => html.indexOf(label));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(html).toContain('aria-label="Jump to category"');
    expect(html).toContain("application-category-current is-complete");
    expect(html).toContain(
      "application-reference-review-button-needs-action",
    );
    expect(html).toContain("application-category-workflow-actions");
  });

  it("places score visibility beside panel comment visibility and shows scores by default", () => {
    const html = renderToStaticMarkup(
      <ApplicationReferenceBar
        categoryNavigation={{
          categories: [{ id: "direction", title: "Direction" }],
          showCompletion: true,
        }}
        panelCommentControls={{ currentUserId: "user-1", peerCount: 3 }}
        panels={panels}
        scoreVisibilityControls={{ currentUserId: "user-1" }}
      />,
    );

    const commentControl = html.indexOf(
      'aria-label="Hide 3 other panel comments"',
    );
    const scoreControl = html.indexOf('aria-label="Hide scores"');

    expect(commentControl).toBeGreaterThanOrEqual(0);
    expect(scoreControl).toBeGreaterThan(commentControl);
    expect(html).toContain('aria-pressed="true"');
  });
});
