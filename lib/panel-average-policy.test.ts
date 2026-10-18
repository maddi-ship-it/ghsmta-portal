import { describe, expect, it } from "vitest";

import type { AdjudicatorAssignment, Profile } from "@/lib/types";

import { resolvePanelAveragePolicy } from "./panel-average-policy";

function assignment(userId: string, canScore = true) {
  return {
    adjudicator_user_id: userId,
    can_score: canScore,
  } as AdjudicatorAssignment;
}

function profile(id: string, role: Profile["role"]) {
  return { id, role } as Profile;
}

describe("panel average policy", () => {
  it("excludes Advisory Committee scores when three adjudicators are assigned", () => {
    const policy = resolvePanelAveragePolicy(
      [
        assignment("adj-1"),
        assignment("adj-2"),
        assignment("adj-3"),
        assignment("acm-1"),
      ],
      [
        profile("adj-1", "adjudicator"),
        profile("adj-2", "adjudicator"),
        profile("adj-3", "adjudicator"),
        profile("acm-1", "advisory_member"),
      ],
    );

    expect([...policy.contributorUserIds]).toEqual([
      "adj-1",
      "adj-2",
      "adj-3",
    ]);
    expect([...policy.referenceUserIds]).toEqual(["acm-1"]);
    expect(policy.adjudicatorOnly).toBe(true);
  });

  it("includes a scoring Advisory Committee member when fewer than three adjudicators are assigned", () => {
    const policy = resolvePanelAveragePolicy(
      [assignment("adj-1"), assignment("adj-2"), assignment("acm-1")],
      [
        profile("adj-1", "adjudicator"),
        profile("adj-2", "adjudicator"),
        profile("acm-1", "advisory_member"),
      ],
    );

    expect([...policy.contributorUserIds]).toEqual([
      "adj-1",
      "adj-2",
      "acm-1",
    ]);
    expect(policy.referenceUserIds.size).toBe(0);
    expect(policy.adjudicatorOnly).toBe(false);
  });

  it("never includes comment-only assignments", () => {
    const policy = resolvePanelAveragePolicy(
      [assignment("adj-1"), assignment("acm-1", false)],
      [
        profile("adj-1", "adjudicator"),
        profile("acm-1", "advisory_member"),
      ],
    );

    expect([...policy.contributorUserIds]).toEqual(["adj-1"]);
    expect(policy.referenceUserIds.size).toBe(0);
  });
});
