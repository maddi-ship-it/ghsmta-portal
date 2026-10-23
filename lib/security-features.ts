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
