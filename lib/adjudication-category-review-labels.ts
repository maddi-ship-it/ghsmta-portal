export function eligibilityDecisionLabel(isEligible: boolean) {
  return `Eligible: ${isEligible ? "Yes" : "No"}`;
}

export function categoryPresenceDecisionLabel({
  categoryTitle,
  isPresent,
}: {
  categoryTitle: string;
  isPresent: boolean;
}) {
  return `Does it have ${categoryTitle}: ${isPresent ? "Yes" : "No"}`;
}
