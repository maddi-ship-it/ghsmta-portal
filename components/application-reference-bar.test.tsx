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
      />,
    );

    const controlLabels = [
      "CURRENT CATEGORY",
      "Review all categories",
      "SPECIALTY AWARDS",
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
});
