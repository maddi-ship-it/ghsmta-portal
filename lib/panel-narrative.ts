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
