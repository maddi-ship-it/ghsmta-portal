import { describe, expect, it, vi } from "vitest";

import { clearForcedPasswordResetForAuthenticatedUser } from "./password-reset-completion";

describe("clearForcedPasswordResetForAuthenticatedUser", () => {
  it.each(["owner-id", "advisory-id", "adjudicator-id", "applicant-id"])(
    "clears the reset requirement for the authenticated account %s",
    async (userId) => {
      const clearProfile = vi.fn(async (authenticatedUserId: string) => ({
        clearedProfileId: authenticatedUserId,
        errorMessage: null,
      }));

      await expect(
        clearForcedPasswordResetForAuthenticatedUser(userId, clearProfile),
      ).resolves.toEqual({ ok: true, errorMessage: null });
      expect(clearProfile).toHaveBeenCalledExactlyOnceWith(userId);
    },
  );

  it("rejects a cleanup that touches a different profile", async () => {
    await expect(
      clearForcedPasswordResetForAuthenticatedUser("signed-in-user", async () => ({
        clearedProfileId: "different-user",
        errorMessage: null,
      })),
    ).resolves.toEqual({
      ok: false,
      errorMessage: "The authenticated user's profile was not cleared.",
    });
  });

  it("returns database cleanup failures", async () => {
    await expect(
      clearForcedPasswordResetForAuthenticatedUser("signed-in-user", async () => ({
        clearedProfileId: null,
        errorMessage: "Database unavailable",
      })),
    ).resolves.toEqual({
      ok: false,
      errorMessage: "Database unavailable",
    });
  });
});
