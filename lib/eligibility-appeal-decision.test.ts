import { describe, expect, it } from "vitest";

import { buildEligibilityAppealDecisionMessage } from "@/lib/eligibility-appeal-decision";

describe("buildEligibilityAppealDecisionMessage", () => {
  it("builds the approved school notice with application details", () => {
    expect(
      buildEligibilityAppealDecisionMessage({
        categoryTitle: "Music Direction",
        contactName: "Courtney Smith",
        currentEligibility: false,
        decision: "approved",
        productionTitle: "Into the Woods",
        schoolName: "Rainey McCullers SOTA",
      }),
    ).toContain(
      "Dear Courtney,\n\nThe Shuler Advisory Committee has completed its review of your appeal regarding the category of Music Direction for Rainey McCullers SOTA's production of Into the Woods.",
    );
    expect(
      buildEligibilityAppealDecisionMessage({
        categoryTitle: "Music Direction",
        contactName: "Courtney Smith",
        currentEligibility: false,
        decision: "approved",
        productionTitle: "Into the Woods",
        schoolName: "Rainey McCullers SOTA",
      }),
    ).toContain("Decision: APPROVED");
  });

  it("keeps the current determination when an appeal is denied", () => {
    expect(
      buildEligibilityAppealDecisionMessage({
        categoryTitle: "Orchestra",
        contactName: null,
        currentEligibility: false,
        decision: "denied",
        productionTitle: null,
        schoolName: "Demo School",
      }),
    ).toContain("This category will remain ineligible for awards consideration.");
  });
});
