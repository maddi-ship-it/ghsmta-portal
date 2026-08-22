import { describe, expect, it } from "vitest";

import {
  isMfaEnforcementActive,
  MFA_ENFORCEMENT_RESUMES_AT,
  mfaGraceDeadline,
} from "./security-features";

describe("MFA enforcement pause", () => {
  it("keeps enforcement disabled until the configured resume instant", () => {
    expect(isMfaEnforcementActive(new Date("2026-10-22T23:17:34.166Z"))).toBe(false);
    expect(isMfaEnforcementActive(new Date(MFA_ENFORCEMENT_RESUMES_AT))).toBe(true);
  });

  it("uses the global resume instant when the normal grace period ends sooner", () => {
    expect(mfaGraceDeadline(new Date("2026-08-22T23:17:34.167Z")).toISOString()).toBe(
      MFA_ENFORCEMENT_RESUMES_AT,
    );
  });

  it("restores the standard fourteen-day grace period after the pause", () => {
    expect(mfaGraceDeadline(new Date("2026-11-01T00:00:00.000Z")).toISOString()).toBe(
      "2026-11-15T00:00:00.000Z",
    );
  });
});
