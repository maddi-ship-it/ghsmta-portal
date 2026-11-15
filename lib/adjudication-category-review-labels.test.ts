import { describe, expect, it } from "vitest";

import {
  categoryPresenceDecisionLabel,
  eligibilityDecisionLabel,
} from "./adjudication-category-review-labels";

describe("category review decision labels", () => {
  it("presents eligibility as an explicit Yes or No", () => {
    expect(eligibilityDecisionLabel(true)).toBe("Eligible: Yes");
    expect(eligibilityDecisionLabel(false)).toBe("Eligible: No");
  });

  it("uses the category name when asking whether it is present", () => {
    expect(
      categoryPresenceDecisionLabel({
        categoryTitle: "Music Direction",
        isPresent: true,
      }),
    ).toBe("Does it have Music Direction: Yes");
    expect(
      categoryPresenceDecisionLabel({
        categoryTitle: "Orchestra",
        isPresent: false,
      }),
    ).toBe("Does it have Orchestra: No");
  });
});
