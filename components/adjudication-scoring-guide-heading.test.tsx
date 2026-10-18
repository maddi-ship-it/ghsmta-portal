import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdjudicationScoringGuideHeading } from "./adjudication-scoring-guide-heading";

describe("AdjudicationScoringGuideHeading", () => {
  it("renders the initial active category in the scoring guide title", () => {
    const html = renderToStaticMarkup(
      <AdjudicationScoringGuideHeading initialCategoryTitle="Music Direction" />,
    );

    expect(html).toContain("Scoring guide");
    expect(html).toContain("Music Direction");
    expect(html).not.toContain("Use the 1–10 scale");
  });
});
