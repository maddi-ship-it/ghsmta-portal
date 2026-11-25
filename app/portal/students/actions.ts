"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { portalAuthCallbackUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";

const PATH = "/portal/students";

export async function inviteStudentFromSchool(formData: FormData) {
  const applicant = await requireProfile(["applicant"]);
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const graduationYear = Number(formData.get("graduation_year"));
  if (!fullName || !email || !Number.isInteger(graduationYear)) throw new Error("Student name, email, and graduation year are required.");
  const admin = createAdminClient();
  const { data: application } = await admin.from("applications").select("school_id,school_name").eq("applicant_user_id", applicant.id).eq("is_archived", false).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!application?.school_id) throw new Error("Your school application must be connected to the school directory before inviting students.");
  let { data: studentAccount } = await admin.from("profiles").select("id,role").eq("email", email).maybeSingle();
  if (studentAccount && !["student", "alumni"].includes(studentAccount.role)) throw new Error("That email already belongs to another portal role.");
  if (!studentAccount) {
    const headerStore = await headers();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName, portal_role: "student", school_id: application.school_id, graduation_year: graduationYear }, redirectTo: portalAuthCallbackUrl("/portal/student/profile?welcome=1", headerStore.get("origin")) });
    if (error || !data.user) throw new Error(error?.message ?? "Student invitation could not be sent.");
    studentAccount = { id: data.user.id, role: "student" };
  }
  await admin.from("student_profiles").upsert({ user_id: studentAccount.id, legal_name: fullName, graduation_year: graduationYear, status: "pending_school" }, { onConflict: "user_id" });
  await admin.from("student_school_requests").update({ status: "cancelled" }).eq("student_user_id", studentAccount.id).eq("status", "pending");
  await admin.from("student_school_requests").insert({ student_user_id: studentAccount.id, school_id: application.school_id, source: "school_invite", requested_by: applicant.id });
  await admin.from("student_invitations").insert({ email, full_name: fullName, school_id: application.school_id, graduation_year: graduationYear, source: "school", invited_by: applicant.id, auth_user_id: studentAccount.id });
  revalidatePath(PATH);
  redirect(`${PATH}?invited=1`);
}
