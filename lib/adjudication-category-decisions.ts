import type { AppRole } from "@/lib/types";

export type CategoryDecision = {
  category_id: string;
  is_eligible: boolean;
  range_min: number | null;
  range_max: number | null;
  advisory_note: string | null;
  owner_override: boolean;
  owner_override_note: string | null;
};

export type ExistingCategoryProposal = {
  id: string;
  category_id: string;
  proposed_by: string;
  is_eligible: boolean;
  range_min: number | string | null;
  range_max: number | string | null;
  status: string;
  advisory_note: string | null;
  owner_override_note: string | null;
  approved_at: string | null;
};

function numbersMatch(
  left: number | string | null,
  right: number | null,
) {
  if (left == null || right == null) return left == null && right == null;
  return Number(left) === right;
}

function rangesMatch(
  existing: ExistingCategoryProposal,
  decision: CategoryDecision,
) {
  const submittedRangeIsValid =
    Number.isFinite(decision.range_min) &&
    Number.isFinite(decision.range_max);

  // Preserve an existing legacy blank range when the row was not edited. If
  // the user clears a previously valid range, the non-null stored values make
  // this return false so normal validation can report the problem.
  if (decision.is_eligible && !submittedRangeIsValid) {
    return existing.range_min == null && existing.range_max == null;
  }

  return (
    numbersMatch(existing.range_min, decision.range_min) &&
    numbersMatch(existing.range_max, decision.range_max)
  );
}

export function categoryDecisionHasChanges(
  decision: CategoryDecision,
  existing: ExistingCategoryProposal | undefined,
  actorRole: AppRole,
) {
  // Advisory members cannot replace an Owner override. Treat that row as
  // read-only here as well as in the database function so it cannot block a
  // save made to another category.
  if (existing?.status === "overridden" && actorRole !== "owner") {
    return false;
  }

  if (!existing) {
    // A category without a proposal renders as eligible with an empty range.
    // That is the untouched UI baseline, not a decision that should be saved.
    return !(
      decision.is_eligible &&
      !Number.isFinite(decision.range_min) &&
      !Number.isFinite(decision.range_max) &&
      decision.advisory_note == null &&
      !decision.owner_override &&
      decision.owner_override_note == null
    );
  }

  return (
    existing.is_eligible !== decision.is_eligible ||
    !rangesMatch(existing, decision) ||
    existing.advisory_note !== decision.advisory_note ||
    (actorRole === "owner" &&
      (existing.owner_override_note !== decision.owner_override_note ||
        (existing.status === "overridden") !== decision.owner_override))
  );
}
