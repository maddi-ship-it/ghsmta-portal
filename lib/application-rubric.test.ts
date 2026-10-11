import { describe, expect, it } from "vitest";

import { categoryBelongsToApplicationRubric } from "./application-rubric";

describe("categoryBelongsToApplicationRubric", () => {
  it("uses the rubric assigned to the application form", () => {
    expect(
      categoryBelongsToApplicationRubric({
        applicationFormRubricId: "shared-rubric",
        categoryRubricId: "shared-rubric",
      }),
    ).toBe(true);
  });

  it("rejects categories from a different rubric", () => {
    expect(
      categoryBelongsToApplicationRubric({
        applicationFormRubricId: "application-rubric",
        categoryRubricId: "other-rubric",
      }),
    ).toBe(false);
  });
});
