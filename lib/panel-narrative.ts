export function resolveGeneratedNarrativeFinal({
  currentGeneratedComment,
  currentFinalComment,
  nextGeneratedComment,
  replaceOwnerDraft = false,
}: {
  currentGeneratedComment: string | null | undefined;
  currentFinalComment: string | null | undefined;
  nextGeneratedComment: string;
  replaceOwnerDraft?: boolean;
}) {
  const generated = currentGeneratedComment?.trim() ?? "";
  const final = currentFinalComment?.trim() ?? "";
  const ownerEditedDraft = Boolean(generated && final && generated !== final);
  const preserveOwnerDraft = ownerEditedDraft && !replaceOwnerDraft;

  return {
    finalComment: preserveOwnerDraft ? final : nextGeneratedComment,
    preservedOwnerDraft: preserveOwnerDraft,
  };
}

export function panelNarrativeSourceAssignmentIds(
  assignments: ReadonlyArray<{
    id: string;
    adjudicator_user_id: string;
    can_comment?: boolean;
    removed_at?: string | null;
  }>,
  contributorUserIds: ReadonlySet<string>,
) {
  return new Set(
    assignments
      .filter(
        (assignment) =>
          assignment.removed_at == null &&
          assignment.can_comment === true &&
          contributorUserIds.has(assignment.adjudicator_user_id),
      )
      .map((assignment) => assignment.id),
  );
}

export function shouldRefreshGeneratedNarrative({
  status,
  generatedAt,
  latestSourceUpdate,
  now,
  cooldownMs,
}: {
  status: string | null | undefined;
  generatedAt: string | null | undefined;
  latestSourceUpdate: number;
  now: number;
  cooldownMs: number;
}) {
  if (status === "approved") return false;

  const generatedAtTime = generatedAt ? Date.parse(generatedAt) : 0;
  if (generatedAtTime && now - generatedAtTime < cooldownMs) return false;

  return !generatedAtTime || latestSourceUpdate > generatedAtTime;
}

export function isAssignedPanelNarrativeReviewer({
  assignedTo,
  reviewerId,
}: {
  assignedTo: string | null | undefined;
  reviewerId: string;
}) {
  return Boolean(assignedTo && assignedTo === reviewerId);
}

export function activePanelMemberUserIds(
  assignments: ReadonlyArray<{
    adjudicator_user_id: string;
    can_score?: boolean;
    can_comment?: boolean;
    removed_at?: string | null;
  }>,
) {
  return [
    ...new Set(
      assignments
        .filter(
          (assignment) =>
            assignment.removed_at == null &&
            (assignment.can_score === true || assignment.can_comment === true),
        )
        .map((assignment) => assignment.adjudicator_user_id),
    ),
  ];
}

export function finalCommentsReadyAnnouncement({
  schoolName,
  productionTitle,
  categoryTitles,
}: {
  schoolName: string;
  productionTitle: string | null | undefined;
  categoryTitles: string[];
}) {
  const productionLabel = productionTitle?.trim()
    ? ` — ${productionTitle.trim()}`
    : "";
  const count = categoryTitles.length;
  const categoryList = categoryTitles
    .map((categoryTitle) => `• ${categoryTitle}`)
    .join("\n");

  return (
    `The Owner sent final comments to the panel for ${schoolName}${productionLabel}.\n\n` +
    `${count} final comment${count === 1 ? " is" : "s are"} ready for panel review.` +
    (categoryList ? `\n${categoryList}` : "") +
    "\n\nAll active panel members can read the comments. Only each assigned writer can edit and approve their comment."
  );
}

export function isPanelNarrativeApprovalComplete({
  assignedTo,
  approvedBy,
  panelReviewerIds,
}: {
  assignedTo: string | null | undefined;
  approvedBy: string | null | undefined;
  panelReviewerIds: ReadonlySet<string>;
}) {
  return Boolean(
    assignedTo &&
      approvedBy &&
      assignedTo === approvedBy &&
      panelReviewerIds.has(approvedBy),
  );
}
