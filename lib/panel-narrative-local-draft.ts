export type PanelNarrativeLocalDraft = {
  applicationId?: string;
  categoryId?: string;
  finalComment?: string;
  approved?: boolean;
  sourceGeneratedAt?: string;
  savedAt?: string;
};

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
