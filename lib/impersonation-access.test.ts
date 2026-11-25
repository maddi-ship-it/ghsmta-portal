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
  it("allows every active portal role", () => {
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
    expect(
      canOwnerImpersonateProfile(
        { ...eligibleProfile, role: "production" },
        ownerId,
      ),
    ).toBe(true);
    for (const role of ["student", "guardian", "alumni", "program_manager", "owner"] as const) {
      expect(
        canOwnerImpersonateProfile({ ...eligibleProfile, role }, ownerId),
      ).toBe(true);
    }
  });

  it("does not allow unavailable accounts", () => {
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
    expect(impersonationRoleName("production")).toBe("Production team member");
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
