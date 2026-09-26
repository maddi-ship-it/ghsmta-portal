"use server";

import { redirect } from "next/navigation";

import { clearForcedPasswordResetForAuthenticatedUser } from "@/lib/password-reset-completion";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("password_confirmation") ?? "");

  if (password.length < 8) redirect("/update-password?error=length");
  if (password !== confirmation) redirect("/update-password?error=match");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/forgot-password?error=session");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(`/update-password?error=${encodeURIComponent(error.code ?? "update")}`);

  // Profile security fields are intentionally Owner-only under RLS. Complete
  // this narrowly scoped cleanup on the server after Supabase has verified
  // the session and successfully changed that same user's password.
  const admin = createAdminClient();
  const clearance = await clearForcedPasswordResetForAuthenticatedUser(
    user.id,
    async (authenticatedUserId) => {
      const { data: clearedProfile, error: profileError } = await admin
        .from("profiles")
        .update({
          force_password_reset: false,
          password_reset_requested_at: null,
        })
        .eq("id", authenticatedUserId)
        .select("id")
        .maybeSingle();

      return {
        clearedProfileId: clearedProfile?.id ?? null,
        errorMessage: profileError?.message ?? null,
      };
    },
  );

  if (!clearance.ok) {
    console.error("Password changed but reset requirement could not be cleared", {
      userId: user.id,
      message: clearance.errorMessage,
    });
    redirect("/update-password?error=finalize");
  }

  await supabase.auth.signOut();
  redirect("/login?message=Your password was updated. Sign in with your new password.");
}
