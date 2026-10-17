export type EligibilityAppealDecision = "approved" | "denied";

function firstName(value: string | null | undefined) {
  return value?.trim().split(/\s+/)[0] || "School Team";
}

export function buildEligibilityAppealDecisionMessage({
  categoryTitle,
  contactName,
  currentEligibility,
  decision,
  productionTitle,
  schoolName,
}: {
  categoryTitle: string;
  contactName: string | null;
  currentEligibility: boolean | null;
  decision: EligibilityAppealDecision;
  productionTitle: string | null;
  schoolName: string;
}) {
  const approved = decision === "approved";
  const determination = approved
    ? "After reviewing the information provided, the Committee has approved your appeal! This category will now be eligible for awards consideration."
    : currentEligibility
      ? "After reviewing the information provided, the Committee has denied your appeal. The current eligible determination will remain unchanged."
      : "After reviewing the information provided, the Committee has denied your appeal. This category will remain ineligible for awards consideration.";

  return [
    `Dear ${firstName(contactName)},`,
    "",
    `The Shuler Advisory Committee has completed its review of your appeal regarding the category of ${categoryTitle} for ${schoolName}'s production of ${productionTitle?.trim() || "Untitled production"}.`,
    "",
    `Decision: ${approved ? "APPROVED" : "DENIED"}`,
    "",
    determination,
    "Your adjudicating panel will be notified of this decision.",
    "",
    "Thank you for your continued participation in the Georgia High School Musical Theatre Awards!",
  ].join("\n");
}
