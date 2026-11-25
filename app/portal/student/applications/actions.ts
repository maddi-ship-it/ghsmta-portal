"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { StudentProgramField } from "@/lib/types";

function applicationPath(id: string) {
  return `/portal/student/applications/${id}`;
}

export async function startStudentApplication(programId: string) {
  const profile = await requireProfile(["student"]);
  const supabase = await createClient();
  const { data: student, error: studentError } = await supabase
    .from("student_profiles")
    .select("status")
    .eq("user_id", profile.id)
    .single();
  if (studentError || !student) throw new Error(studentError?.message ?? "Student profile not found.");
  if (student.status !== "active") throw new Error("Your school connection must be approved before starting an application.");

  const { data: program, error: programError } = await supabase
    .from("student_programs")
    .select("id,availability,status,opens_at,closes_at")
    .eq("id", programId)
    .single();
  if (programError || !program) throw new Error(programError?.message ?? "Application not found.");
  const now = Date.now();
  if (program.status !== "open" || (program.opens_at && new Date(program.opens_at).getTime() > now) || (program.closes_at && new Date(program.closes_at).getTime() < now)) {
    throw new Error("This application is not currently open.");
  }

  let assignmentId: string | null = null;
  if (program.availability === "assigned") {
    const admin = createAdminClient();
    const { data: assignment } = await admin.from("student_program_assignments").select("id").eq("program_id", programId).eq("student_user_id", profile.id).maybeSingle();
    if (!assignment) throw new Error("This application must be assigned by a GHSMTA Owner.");
    assignmentId = assignment.id;
  }

  const { data: existing } = await supabase.from("student_submissions").select("id").eq("program_id", programId).eq("student_user_id", profile.id).maybeSingle();
  if (existing) redirect(applicationPath(existing.id));

  const { data, error } = await supabase.from("student_submissions").insert({
    program_id: programId,
    student_user_id: profile.id,
    assignment_id: assignmentId,
  }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Application could not be started.");
  redirect(applicationPath(data.id));
}

function responseValue(field: StudentProgramField, formData: FormData) {
  if (field.field_type === "multi_select") return formData.getAll(field.field_key).map(String);
  if (field.field_type === "checkbox") return formData.get(field.field_key) === "on";
  if (field.field_type === "content" || field.field_type === "file") return undefined;
  const raw = String(formData.get(field.field_key) ?? "").trim();
  if (field.field_type === "number") return raw ? Number(raw) : null;
  return raw || null;
}

function responsePresent(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  return value !== null && value !== undefined && String(value).trim().length > 0;
}

export async function saveStudentApplication(submissionId: string, intent: "save" | "submit", formData: FormData) {
  const profile = await requireProfile(["student"]);
  const supabase = await createClient();
  const { data: submission, error: submissionError } = await supabase
    .from("student_submissions")
    .select("id,program_id,student_user_id,status,responses")
    .eq("id", submissionId)
    .eq("student_user_id", profile.id)
    .single();
  if (submissionError || !submission) throw new Error(submissionError?.message ?? "Application not found.");
  if (!["draft", "returned"].includes(submission.status)) throw new Error("This application is no longer editable.");

  const { data: fieldRows, error: fieldsError } = await supabase.from("student_program_fields").select("*").eq("program_id", submission.program_id).eq("active", true).order("sort_order");
  if (fieldsError) throw new Error(fieldsError.message);
  const fields = (fieldRows ?? []) as StudentProgramField[];
  const responses = { ...(submission.responses as Record<string, unknown>) };
  for (const field of fields) {
    const value = responseValue(field, formData);
    if (value !== undefined) responses[field.field_key] = value;
  }

  if (intent === "submit") {
    const missing = fields.filter((field) => field.required && !["content", "file"].includes(field.field_type) && !responsePresent(responses[field.field_key]));
    const fileFields = fields.filter((field) => field.required && field.field_type === "file");
    if (fileFields.length > 0) {
      const { data: files } = await supabase.from("portal_files").select("document_category").eq("context_type", "student_submission").eq("context_id", submissionId);
      const uploaded = new Set((files ?? []).map((file) => file.document_category));
      missing.push(...fileFields.filter((field) => !uploaded.has(field.field_key)));
    }
    if (missing.length > 0) throw new Error(`Complete the required field${missing.length === 1 ? "" : "s"}: ${missing.map((field) => field.label).join(", ")}.`);
  }

  const { error } = await supabase.from("student_submissions").update({
    responses,
    status: intent === "submit" ? "submitted" : submission.status,
    submitted_at: intent === "submit" ? new Date().toISOString() : undefined,
  }).eq("id", submissionId).eq("student_user_id", profile.id);
  if (error) throw new Error(error.message);
  revalidatePath(applicationPath(submissionId));
  revalidatePath("/portal/student/applications");
  redirect(`${applicationPath(submissionId)}?${intent === "submit" ? "submitted" : "saved"}=1`);
}
