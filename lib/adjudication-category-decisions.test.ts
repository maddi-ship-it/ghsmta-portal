import { describe, expect, it } from "vitest";

import {
  categoryDecisionHasChanges,
  type CategoryDecision,
  type ExistingCategoryProposal,
} from "./adjudication-category-decisions";

const baseDecision: CategoryDecision = {
  category_id: "category-1",
  is_eligible: true,
  range_min: 5,
  range_max: 7,
  advisory_note: null,
  owner_override: false,
  owner_override_note: null,
};

const baseProposal: ExistingCategoryProposal = {
  id: "proposal-1",
  category_id: "category-1",
  proposed_by: "user-1",
  is_eligible: true,
  range_min: "5.00",
  range_max: "7.00",
  status: "proposed",
  advisory_note: null,
  owner_override_note: null,
  approved_at: null,
};

describe("categoryDecisionHasChanges", () => {
  it("ignores a new category that still has the untouched blank-range defaults", () => {
    expect(
      categoryDecisionHasChanges(
        { ...baseDecision, range_min: Number.NaN, range_max: Number.NaN },
        undefined,
        "advisory_member",
      ),
    ).toBe(false);
  });

  it("saves a range selected for one previously untouched category", () => {
    expect(
      categoryDecisionHasChanges(
        baseDecision,
        undefined,
        "advisory_member",
      ),
    ).toBe(true);
  });

  it("recognizes an unchanged stored range even when Postgres returns decimals as strings", () => {
    expect(
      categoryDecisionHasChanges(
        baseDecision,
        baseProposal,
        "advisory_member",
      ),
    ).toBe(false);
  });

  it("saves an edited advisory note without touching other categories", () => {
    expect(
      categoryDecisionHasChanges(
        { ...baseDecision, advisory_note: "Updated note" },
        baseProposal,
        "advisory_member",
      ),
    ).toBe(true);
  });

  it("does not let an Owner override block an advisory member's other edits", () => {
    expect(
      categoryDecisionHasChanges(
        { ...baseDecision, range_min: Number.NaN, range_max: Number.NaN },
        {
          ...baseProposal,
          status: "overridden",
          owner_override_note: "Owner decision",
        },
        "advisory_member",
      ),
    ).toBe(false);
  });

  it("detects when an Owner removes an override", () => {
    expect(
      categoryDecisionHasChanges(
        baseDecision,
        {
          ...baseProposal,
          status: "overridden",
          owner_override_note: "Owner decision",
        },
        "owner",
      ),
    ).toBe(true);
  });
});
