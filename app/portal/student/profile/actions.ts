"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { normalizePhoneE164 } from "@/lib/phone";
import { portalAuthCallbackUrl } from "@/lib/site-url";
import { isStudentSchoolOption } from "@/lib/student-school-options";
import { createAdminClient } from "@/lib/supabase/admin";

const PROFILE_PATH = "/portal/student/profile";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function saveStudentProfile(formData: FormData) {
  const profile = await requireProfile(["student", "alumni"]);
  if (profile.role === "alumni") throw new Error("Alumni profiles are read-only.");

  const legalName = field(formData, "legal_name");
  const preferredName = field(formData, "preferred_name");
  const pronouns = field(formData, "pronouns");
  const phone = normalizePhoneE164(field(formData, "phone"));
  const graduationYear = Number(formData.get("graduation_year"));
  const schoolId = field(formData, "school_id");

  if (!legalName || !phone || !Number.isInteger(graduationYear)) {
    throw new Error("Legal name, phone, and graduation year are required.");
  }

  const admin = createAdminClient();
  const { data: currentStudent, error: currentError } = await admin
    .from("student_profiles")
    .select("school_id,status")
    .eq("user_id", profile.id)
    .single();
  if (currentError) throw new Error(currentError.message);

  const { error: studentError } = await admin.from("student_profiles").update({
    legal_name: legalName,
    preferred_name: preferredName || null,
    pronouns: pronouns || null,
    graduation_year: graduationYear,
    emergency_contact_name: field(formData, "emergency_contact_name") || null,
    emergency_contact_relationship: field(formData, "emergency_contact_relationship") || null,
    emergency_contact_phone: normalizePhoneE164(field(formData, "emergency_contact_phone")),
    performer_credits: field(formData, "performer_credits") || null,
    production_credits: field(formData, "production_credits") || null,
    accessibility_accommodations: field(formData, "accessibility_accommodations") || null,
    tshirt_size: field(formData, "tshirt_size") || null,
    dietary_needs: field(formData, "dietary_needs") || null,
  }).eq("user_id", profile.id);
  if (studentError) throw new Error(studentError.message);

  const { error: profileError } = await admin.from("profiles").update({
    full_name: legalName,
    preferred_name: preferredName || null,
    pronouns: pronouns || null,
    phone_e164: phone,
  }).eq("id", profile.id);
  if (profileError) throw new Error(profileError.message);

  if (schoolId && schoolId !== currentStudent.school_id) {
    const { data: school } = await admin.from("schools").select("id,name").eq("id", schoolId).eq("active", true).maybeSingle();
    if (!school || !isStudentSchoolOption(school.name, process.env.NODE_ENV !== "production")) throw new Error("Choose an active school.");
    await admin.from("student_school_requests").update({ status: "cancelled" }).eq("student_user_id", profile.id).eq("status", "pending");
    const { error: requestError } = await admin.from("student_school_requests").insert({
      student_user_id: profile.id,
      school_id: schoolId,
      source: currentStudent.school_id ? "transfer" : "self_registration",
      requested_by: profile.id,
    });
    if (requestError) throw new Error(requestError.message);
  }

  await admin.from("student_portal_audit_log").insert({
    actor_user_id: profile.id,
    student_user_id: profile.id,
    action: "profile_updated",
    entity_type: "student_profile",
    entity_id: profile.id,
  });
  revalidatePath(PROFILE_PATH);
  redirect(`${PROFILE_PATH}?saved=1`);
}

export async function inviteGuardian(formData: FormData) {
  const student = await requireProfile(["student"]);
  const email = field(formData, "guardian_email").toLowerCase();
  const name = field(formData, "guardian_name");
  const relationship = field(formData, "relationship");
  if (!email || !email.includes("@")) throw new Error("Enter a guardian email address.");

  const admin = createAdminClient();
  let { data: guardianProfile } = await admin.from("profiles").select("id,role").eq("email", email).maybeSingle();

  if (guardianProfile && guardianProfile.role !== "guardian") {
    throw new Error("That email already belongs to a non-guardian portal account.");
  }

  if (!guardianProfile) {
    const headerStore = await headers();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: name || email,
        portal_role: "guardian",
      },
      redirectTo: portalAuthCallbackUrl("/portal/guardian", headerStore.get("origin")),
    });
    if (error || !data.user) throw new Error(error?.message ?? "The guardian invitation could not be sent.");
    guardianProfile = { id: data.user.id, role: "guardian" };
  }

  const { error } = await admin.from("guardian_student_links").upsert({
    guardian_user_id: guardianProfile.id,
    student_user_id: student.id,
    guardian_email: email,
    guardian_name: name || null,
    relationship: relationship || null,
    status: "invited",
    invited_by: student.id,
    invited_at: new Date().toISOString(),
    removed_at: null,
  }, { onConflict: "guardian_user_id,student_user_id" });
  if (error) throw new Error(error.message);

  await admin.from("user_notifications").insert({
    user_id: guardianProfile.id,
    notification_type: "guardian_invitation",
    title: "You were added as a guardian",
    body: `${profileName(student)} added you to their GHSMTA student profile.`,
    href: "/portal/guardian",
  });

  revalidatePath(PROFILE_PATH);
  redirect(`${PROFILE_PATH}?guardian_invited=1`);
}

function profileName(profile: { full_name: string | null; email: string | null }) {
  return profile.full_name ?? profile.email ?? "A student";
}

export async function removeGuardian(linkId: string) {
  const student = await requireProfile(["student"]);
  const admin = createAdminClient();
  const { error } = await admin.from("guardian_student_links").update({
    status: "removed",
    removed_at: new Date().toISOString(),
  }).eq("id", linkId).eq("student_user_id", student.id);
  if (error) throw new Error(error.message);
  revalidatePath(PROFILE_PATH);
}
