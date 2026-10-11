import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CriterionScoringGuideButton } from "./criterion-scoring-guide-button";

describe("CriterionScoringGuideButton", () => {
  it("uses the full criterion scoring guide label", () => {
    const html = renderToStaticMarkup(
      <CriterionScoringGuideButton
        categoryTitle="Direction"
        criterionId="criterion-1"
        criterionTitle="Concept and storytelling"
        productionTitle="Example Musical"
      />,
    );

    expect(html).toContain(">Criterion scoring guide</button>");
    expect(html).toContain(
      'title="Open scoring guide for Concept and storytelling"',
    );
  });
});
