"use server";

import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { normalizePhoneE164 } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function secretsMatch(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function fail(code: string): never {
  redirect(`/staff-signup?error=${encodeURIComponent(code)}`);
}

export async function staffSignup(formData: FormData) {
  if (process.env.STAFF_SIGNUP_ENABLED === "false") {
    fail("disabled");
  }

  const expectedAccessCode =
    process.env.STAFF_SIGNUP_ACCESS_CODE?.trim() ?? "";

  if (!expectedAccessCode) {
    fail("unavailable");
  }

  const fullName = text(formData, "full_name");
  const email = text(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const phone = normalizePhoneE164(text(formData, "phone"));
  const accessCode = text(formData, "access_code");

  if (!fullName || !email || password.length < 8 || !phone) {
    fail("invalid");
  }

  if (!secretsMatch(accessCode, expectedAccessCode)) {
    fail("access-code");
  }

  const headerStore = await headers();
  const origin =
    headerStore.get("origin") ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";
  const phoneVerificationEnabled =
    process.env.PHONE_VERIFICATION_ENABLED === "true";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        phone_e164: phone,
        require_phone_verification: phoneVerificationEnabled,
        staff_signup: true,
        requested_role: "adjudicator",
      },
      emailRedirectTo: `${origin}/auth/callback?next=${
        phoneVerificationEnabled ? "/verify-phone" : "/portal"
      }`,
    },
  });

  if (error || !data.user) {
    fail("exists");
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .update({
      email,
      full_name: fullName,
      role: "adjudicator",
      active: true,
    })
    .eq("id", data.user.id)
    .select("id")
    .single();

  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(data.user.id);
    fail("provision");
  }

  if (data.session) {
    redirect(
      phoneVerificationEnabled ? "/verify-phone" : "/portal",
    );
  }

  redirect(
    "/login?message=Check your email to confirm your staff account, then sign in.",
  );
}
