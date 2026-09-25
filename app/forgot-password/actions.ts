"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { portalAuthCallbackUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/forgot-password?error=missing");

  const headerStore = await headers();
  const redirectTo = portalAuthCallbackUrl(
    "/update-password",
    headerStore.get("origin"),
  );

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    console.error("Password reset request failed", error);
  }

  redirect("/forgot-password?sent=1");
}
