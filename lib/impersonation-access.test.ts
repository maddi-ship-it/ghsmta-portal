import { describe, expect, it } from "vitest";

import {
  canOwnerImpersonateProfile,
  impersonationRoleName,
  isActiveOwnerImpersonation,
} from "@/lib/impersonation-access";

const ownerId = "owner-id";
const eligibleProfile = {
  id: "target-id",
  email: "target@example.com",
  role: "applicant" as const,
  active: true,
  force_password_reset: false,
};

describe("Owner impersonation access", () => {
  it("allows active applicants, adjudicators, and Advisory Committee members", () => {
    expect(canOwnerImpersonateProfile(eligibleProfile, ownerId)).toBe(true);
    expect(
      canOwnerImpersonateProfile(
        { ...eligibleProfile, role: "adjudicator" },
        ownerId,
      ),
    ).toBe(true);
    expect(
      canOwnerImpersonateProfile(
        { ...eligibleProfile, role: "advisory_member" },
        ownerId,
      ),
    ).toBe(true);
  });

  it("does not allow other roles or unavailable accounts", () => {
    expect(
      canOwnerImpersonateProfile(
        { ...eligibleProfile, role: "program_manager" },
        ownerId,
      ),
    ).toBe(false);
    expect(
      canOwnerImpersonateProfile(
        { ...eligibleProfile, active: false },
        ownerId,
      ),
    ).toBe(false);
    expect(
      canOwnerImpersonateProfile(
        { ...eligibleProfile, force_password_reset: true },
        ownerId,
      ),
    ).toBe(false);
    expect(
      canOwnerImpersonateProfile({ ...eligibleProfile, id: ownerId }, ownerId),
    ).toBe(false);
  });

  it("uses the portal-facing committee role name", () => {
    expect(impersonationRoleName("advisory_member")).toBe(
      "Advisory Committee member",
    );
    expect(impersonationRoleName("adjudicator")).toBe("adjudicator");
  });

  it("only recognizes the signed session's target profile", () => {
    expect(
      isActiveOwnerImpersonation({ targetId: "committee-id" }, "committee-id"),
    ).toBe(true);
    expect(
      isActiveOwnerImpersonation({ targetId: "committee-id" }, "other-id"),
    ).toBe(false);
    expect(isActiveOwnerImpersonation(null, "committee-id")).toBe(false);
  });
});
