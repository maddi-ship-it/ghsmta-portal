/**
 * Temporary authentication feature flags.
 *
 * Phone verification defaults to disabled. To restore it later, set:
 *
 *   PHONE_VERIFICATION_ENABLED=true
 *
 * in Vercel and redeploy.
 */
export const PHONE_VERIFICATION_ENABLED =
  process.env.PHONE_VERIFICATION_ENABLED === "true";

/**
 * MFA enforcement is paused for every account until this instant. Enrolled
 * factors are intentionally preserved so enforcement can resume without
 * asking users to enroll again.
 */
export const MFA_ENFORCEMENT_RESUMES_AT =
  "2026-10-22T23:17:34.167Z";

export function isMfaEnforcementActive(now = new Date()) {
  return now.getTime() >= new Date(MFA_ENFORCEMENT_RESUMES_AT).getTime();
}

export function mfaGraceDeadline(now = new Date()) {
  const standardGraceDeadline = new Date(
    now.getTime() + 14 * 24 * 60 * 60 * 1000,
  );
  const pausedUntil = new Date(MFA_ENFORCEMENT_RESUMES_AT);

  return standardGraceDeadline > pausedUntil
    ? standardGraceDeadline
    : pausedUntil;
}
