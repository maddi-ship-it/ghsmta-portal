import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CriterionScoringGuideButton } from "./criterion-scoring-guide-button";

describe("CriterionScoringGuideButton", () => {
  it("uses the criterion focused scoring guide label", () => {
    const html = renderToStaticMarkup(
      <CriterionScoringGuideButton
        categoryTitle="Direction"
        criterionId="criterion-1"
        criterionTitle="Concept and storytelling"
        productionTitle="Example Musical"
      />,
    );

    expect(html).toContain(">CRITERION FOCUSED SCORING GUIDE</button>");
    expect(html).toContain(
      'title="Open criterion focused scoring guide for Concept and storytelling"',
    );
  });
});
