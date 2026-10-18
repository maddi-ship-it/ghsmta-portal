import { describe, expect, it } from "vitest";

import {
  categoryDecisionHasChanges,
  categoryDecisionNeedsSave,
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

  it("keeps the range when a category is not award eligible", () => {
    const ineligibleDecision = {
      ...baseDecision,
      is_eligible: false,
    };
    const ineligibleProposal = {
      ...baseProposal,
      is_eligible: false,
    };

    expect(
      categoryDecisionHasChanges(
        ineligibleDecision,
        undefined,
        "advisory_member",
      ),
    ).toBe(true);
    expect(
      categoryDecisionHasChanges(
        ineligibleDecision,
        ineligibleProposal,
        "advisory_member",
      ),
    ).toBe(false);
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

describe("categoryDecisionNeedsSave", () => {
  const draftProposal = { ...baseProposal, status: "draft" };

  it("does not rewrite an unchanged draft while saving and closing", () => {
    expect(
      categoryDecisionNeedsSave(
        baseDecision,
        draftProposal,
        "advisory_member",
        "draft",
      ),
    ).toBe(false);
  });

  it("submits an unchanged draft when it is sent for approval", () => {
    expect(
      categoryDecisionNeedsSave(
        baseDecision,
        draftProposal,
        "advisory_member",
        "approval",
      ),
    ).toBe(true);
  });
});
