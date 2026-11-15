export type ExistingScoreDraftRow = {
  criterion_id: string;
  observation: string | null;
  score: number | null;
};

export type NextScoreDraftRow = {
  criterion_id: string;
  observation?: string | null;
  score?: number | null;
};

export type ExistingCategoryCommentDraftRow = {
  category_id: string;
  is_applicable: boolean;
  is_eligible: boolean;
  not_applicable_reason: string | null;
  private_notes: string | null;
  score_range_max: number | null;
  score_range_min: number | null;
  subject_name: string | null;
};

export type NextCategoryCommentDraftRow = {
  category_id: string;
  is_applicable: boolean;
  is_eligible: boolean;
  not_applicable_reason: string | null;
  private_notes?: string | null;
  score_range_max: number | null;
  score_range_min: number | null;
  subject_name: string | null;
};

function owns<Key extends PropertyKey>(value: object, key: Key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function scoreDraftRowChanged(
  existing: ExistingScoreDraftRow | undefined,
  next: NextScoreDraftRow,
) {
  if (!existing) return true;
  if (owns(next, "score") && existing.score !== (next.score ?? null)) {
    return true;
  }
  if (
    owns(next, "observation") &&
    existing.observation !== (next.observation ?? null)
  ) {
    return true;
  }
  return false;
}

export function categoryCommentDraftRowChanged(
  existing: ExistingCategoryCommentDraftRow | undefined,
  next: NextCategoryCommentDraftRow,
) {
  if (!existing) return true;

  if (
    existing.subject_name !== next.subject_name ||
    existing.is_applicable !== next.is_applicable ||
    existing.is_eligible !== next.is_eligible ||
    existing.not_applicable_reason !== next.not_applicable_reason ||
    existing.score_range_min !== next.score_range_min ||
    existing.score_range_max !== next.score_range_max
  ) {
    return true;
  }

  return (
    owns(next, "private_notes") &&
    existing.private_notes !== (next.private_notes ?? null)
  );
}
