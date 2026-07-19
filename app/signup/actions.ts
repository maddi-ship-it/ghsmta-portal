"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { normalizePhoneE164 } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export async function signup(formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const phone = normalizePhoneE164(String(formData.get("phone") ?? ""));

  if (!fullName || !email || password.length < 8 || !phone) {
    redirect("/signup?error=invalid");
  }

  const headerStore = await headers();
  const origin =
    headerStore.get("origin") ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        phone_e164: phone,
        require_phone_verification: true,
      },
      emailRedirectTo: `${origin}/auth/callback?next=/verify-phone`,
    },
  });

  if (error) redirect("/signup?error=exists");
  if (data.session) redirect("/verify-phone");

  redirect(
    "/login?message=Check your email to confirm your account, then sign in and verify your mobile number.",
  );
}
