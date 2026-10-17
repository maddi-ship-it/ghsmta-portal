export type NarrativeAssignment = {
  categoryId: string;
  assignedTo: string | null;
};

export function completedNarrativeAssignmentsNow({
  categoryIds,
  previousAssignments,
  nextAssignments,
}: {
  categoryIds: string[];
  previousAssignments: NarrativeAssignment[];
  nextAssignments: NarrativeAssignment[];
}) {
  const previousByCategory = new Map(
    previousAssignments.map((assignment) => [
      assignment.categoryId,
      assignment.assignedTo,
    ]),
  );
  const nextByCategory = new Map(
    nextAssignments.map((assignment) => [
      assignment.categoryId,
      assignment.assignedTo,
    ]),
  );
  const wereComplete = categoryIds.every((categoryId) =>
    Boolean(previousByCategory.get(categoryId)),
  );
  const areComplete = categoryIds.every((categoryId) =>
    Boolean(nextByCategory.get(categoryId)),
  );

  return !wereComplete && areComplete;
}

export function narrativeAssignmentAnnouncement({
  schoolName,
  productionTitle,
  assignments,
}: {
  schoolName: string;
  productionTitle: string | null;
  assignments: Array<{ categoryTitle: string; reviewerName: string }>;
}) {
  const productionLabel = productionTitle?.trim()
    ? ` — ${productionTitle.trim()}`
    : "";
  const lines = assignments.map(
    (assignment) =>
      `• ${assignment.categoryTitle} — ${assignment.reviewerName}`,
  );

  return `Final comment writers have been assigned for ${schoolName}${productionLabel}.\n\n${lines.join("\n")}`;
}
