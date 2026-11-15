export type PanelNarrativeLocalDraft = {
  applicationId?: string;
  approvalChanged?: boolean;
  categoryId?: string;
  finalComment?: string;
  approved?: boolean;
  sourceGeneratedAt?: string;
  savedAt?: string;
};

export function resolvePanelNarrativeDraftApproval({
  existingDraftApprovalChanged,
  existingDraftApproved,
  nextApproved,
  serverApproved,
}: {
  existingDraftApprovalChanged: boolean | undefined;
  existingDraftApproved: boolean | undefined;
  nextApproved: boolean | undefined;
  serverApproved: boolean;
}) {
  if (nextApproved !== undefined) return nextApproved;
  if (
    existingDraftApprovalChanged &&
    existingDraftApproved !== undefined
  ) {
    return existingDraftApproved;
  }
  if (serverApproved) return true;
  return existingDraftApproved ?? false;
}

export function panelNarrativeDraftHasNewerServerVersion({
  draftSourceGeneratedAt,
  latestSourceGeneratedAt,
}: {
  draftSourceGeneratedAt: string | null | undefined;
  latestSourceGeneratedAt: string | null | undefined;
}) {
  return Boolean(
    latestSourceGeneratedAt &&
      (draftSourceGeneratedAt ?? "") !== latestSourceGeneratedAt,
  );
}

export function rebasePanelNarrativeLocalDraft({
  draft,
  latestSourceGeneratedAt,
  savedAt,
}: {
  draft: PanelNarrativeLocalDraft;
  latestSourceGeneratedAt: string;
  savedAt: string;
}): PanelNarrativeLocalDraft {
  return {
    ...draft,
    sourceGeneratedAt: latestSourceGeneratedAt,
    savedAt,
  };
}
