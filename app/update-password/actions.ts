"use server";

import { redirect } from "next/navigation";

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

  await supabase
    .from("profiles")
    .update({
      force_password_reset: false,
      password_reset_requested_at: null,
    })
    .eq("id", user.id);

  await supabase.auth.signOut();
  redirect("/login?message=Your password was updated. Sign in with your new password.");
}
