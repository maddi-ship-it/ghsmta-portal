export type PasswordResetProfileClearResult = {
  clearedProfileId: string | null;
  errorMessage: string | null;
};

export type PasswordResetProfileClearer = (
  authenticatedUserId: string,
) => Promise<PasswordResetProfileClearResult>;

export async function clearForcedPasswordResetForAuthenticatedUser(
  authenticatedUserId: string,
  clearProfile: PasswordResetProfileClearer,
) {
  const result = await clearProfile(authenticatedUserId);

  if (result.errorMessage) {
    return { ok: false as const, errorMessage: result.errorMessage };
  }

  if (result.clearedProfileId !== authenticatedUserId) {
    return {
      ok: false as const,
      errorMessage: "The authenticated user's profile was not cleared.",
    };
  }

  return { ok: true as const, errorMessage: null };
}
