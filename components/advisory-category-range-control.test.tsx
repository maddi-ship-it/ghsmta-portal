import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/portal/adjudication/[id]/workflow-actions", () => ({
  saveFullScoreCategoryRanges: vi.fn(),
}));

import { AdvisoryCategoryRangeControl } from "./advisory-category-range-control";

describe("AdvisoryCategoryRangeControl", () => {
  it("shows the saved manual range and explains where it is linked", () => {
    const html = renderToStaticMarkup(
      <AdvisoryCategoryRangeControl
        applicationId="application-one"
        categoryId="music"
        categoryTitle="Music Direction"
        initialRangeStart={6.25}
        isEligible
      />,
    );

    expect(html).toContain("Two-point range for Music Direction");
    expect(html).toContain("linked with Review all categories");
    expect(html).toContain(
      '<option value="6.25" selected="">6.25–8.25</option>',
    );
    expect(html).toContain("Save range");
  });
});
