"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { normalizePhoneE164 } from "@/lib/phone";
import { portalAuthCallbackUrl } from "@/lib/site-url";
import { isStudentSchoolOption } from "@/lib/student-school-options";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function studentSignup(formData: FormData) {
  const legalName = String(formData.get("legal_name") ?? "").trim();
  const preferredName = String(formData.get("preferred_name") ?? "").trim();
  const pronouns = String(formData.get("pronouns") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const phone = normalizePhoneE164(String(formData.get("phone") ?? ""));
  const schoolId = String(formData.get("school_id") ?? "").trim();
  const graduationYear = Number(formData.get("graduation_year"));
  const ageConfirmed = formData.get("age_confirmed") === "on";

  if (
    !legalName ||
    !email ||
    password.length < 8 ||
    !phone ||
    !schoolId ||
    !Number.isInteger(graduationYear) ||
    graduationYear < new Date().getFullYear() - 1 ||
    graduationYear > new Date().getFullYear() + 8 ||
    !ageConfirmed
  ) {
    redirect("/student-signup?error=invalid");
  }

  const admin = createAdminClient();
  const { data: school } = await admin
    .from("schools")
    .select("id,name")
    .eq("id", schoolId)
    .eq("active", true)
    .maybeSingle();
  if (!school || !isStudentSchoolOption(school.name, process.env.NODE_ENV !== "production")) redirect("/student-signup?error=school");

  const headerStore = await headers();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: legalName,
        preferred_name: preferredName || null,
        pronouns: pronouns || null,
        phone_e164: phone,
        require_phone_verification: false,
        portal_role: "student",
        school_id: schoolId,
        graduation_year: graduationYear,
      },
      emailRedirectTo: portalAuthCallbackUrl(
        "/portal/student/profile",
        headerStore.get("origin"),
      ),
    },
  });

  if (error) redirect("/student-signup?error=exists");
  if (data.session) redirect("/portal/student/profile?welcome=1");

  redirect(
    "/login?message=Check your email to confirm your student account. Your school connection will then be sent to GHSMTA for approval.",
  );
}
