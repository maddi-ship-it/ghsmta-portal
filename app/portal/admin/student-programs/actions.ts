"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StudentProgramFieldType } from "@/lib/types";

const PROGRAMS_PATH = "/portal/admin/student-programs";
const FIELD_TYPES: StudentProgramFieldType[] = ["short_text", "long_text", "email", "phone", "number", "date", "select", "multi_select", "yes_no", "checkbox", "file", "content"];

function value(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function slug(input: string) { return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
function options(formData: FormData) { return value(formData, "options").split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }

export async function createStudentProgram(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const name = value(formData, "name");
  if (!name) throw new Error("Application name is required.");
  const admin = createAdminClient();
  const { data, error } = await admin.from("student_programs").insert({ name, description: value(formData, "description") || null, availability: value(formData, "availability") || "assigned", requires_guardian_signature: formData.get("requires_guardian_signature") === "on", created_by: owner.id }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Application could not be created.");
  redirect(`${PROGRAMS_PATH}/${data.id}`);
}

export async function updateStudentProgram(programId: string, formData: FormData) {
  await requireProfile(["owner"]);
  const name = value(formData, "name");
  const status = value(formData, "status");
  const availability = value(formData, "availability");
  if (!name || !["draft", "open", "closed", "archived"].includes(status) || !["open", "assigned"].includes(availability)) throw new Error("Enter a valid application name, status, and availability.");
  const admin = createAdminClient();
  const { error } = await admin.from("student_programs").update({ name, description: value(formData, "description") || null, instructions: value(formData, "instructions") || null, status, availability, opens_at: value(formData, "opens_at") ? new Date(value(formData, "opens_at")).toISOString() : null, closes_at: value(formData, "closes_at") ? new Date(value(formData, "closes_at")).toISOString() : null, requires_guardian_signature: formData.get("requires_guardian_signature") === "on" }).eq("id", programId);
  if (error) throw new Error(error.message);
  revalidatePath(`${PROGRAMS_PATH}/${programId}`);
  revalidatePath(PROGRAMS_PATH);
}

export async function addStudentProgramField(programId: string, formData: FormData) {
  await requireProfile(["owner"]);
  const label = value(formData, "label");
  const fieldType = value(formData, "field_type") as StudentProgramFieldType;
  const fieldKey = slug(value(formData, "field_key") || label);
  if (!label || !fieldKey || !FIELD_TYPES.includes(fieldType)) throw new Error("Label and field type are required.");
  const admin = createAdminClient();
  const { error } = await admin.from("student_program_fields").insert({ program_id: programId, field_key: fieldKey, label, description: value(formData, "description") || null, field_type: fieldType, required: formData.get("required") === "on", options: options(formData), sort_order: Number(formData.get("sort_order")) || 0 });
  if (error) throw new Error(error.message);
  revalidatePath(`${PROGRAMS_PATH}/${programId}`);
}

export async function updateStudentProgramField(programId: string, fieldId: string, formData: FormData) {
  await requireProfile(["owner"]);
  const label = value(formData, "label");
  const fieldType = value(formData, "field_type") as StudentProgramFieldType;
  const fieldKey = slug(value(formData, "field_key") || label);
  if (!label || !fieldKey || !FIELD_TYPES.includes(fieldType)) throw new Error("Label and field type are required.");
  const admin = createAdminClient();
  const { error } = await admin.from("student_program_fields").update({ field_key: fieldKey, label, description: value(formData, "description") || null, field_type: fieldType, required: formData.get("required") === "on", active: formData.get("active") === "on", options: options(formData), sort_order: Number(formData.get("sort_order")) || 0 }).eq("id", fieldId).eq("program_id", programId);
  if (error) throw new Error(error.message);
  revalidatePath(`${PROGRAMS_PATH}/${programId}`);
}

export async function deleteStudentProgramField(programId: string, fieldId: string) {
  await requireProfile(["owner"]);
  const admin = createAdminClient();
  const { error } = await admin.from("student_program_fields").delete().eq("id", fieldId).eq("program_id", programId);
  if (error) throw new Error(error.message);
  revalidatePath(`${PROGRAMS_PATH}/${programId}`);
}

export async function bulkAssignStudentProgram(programId: string, formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const studentIds = [...new Set(formData.getAll("student_ids").map(String).filter(Boolean))];
  if (studentIds.length === 0) throw new Error("Select at least one student.");
  const isNominee = formData.get("is_nominee") === "on";
  const admin = createAdminClient();
  const { error } = await admin.from("student_program_assignments").upsert(studentIds.map((studentId) => ({ program_id: programId, student_user_id: studentId, assigned_by: owner.id, is_nominee: isNominee })), { onConflict: "program_id,student_user_id" });
  if (error) throw new Error(error.message);
  const { data: program } = await admin.from("student_programs").select("name").eq("id", programId).single();
  await admin.from("user_notifications").insert(studentIds.map((studentId) => ({ user_id: studentId, notification_type: "student_application_assigned", title: "A new student application is available", body: `${program?.name ?? "A GHSMTA opportunity"} is now available in your student portal.`, href: "/portal/student/applications" })));
  revalidatePath(`${PROGRAMS_PATH}/${programId}`);
}
