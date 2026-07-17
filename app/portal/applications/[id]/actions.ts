"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ApplicationQuestion, ApplicationStatus } from "@/lib/types";

function answerValue(question: ApplicationQuestion, formData: FormData): unknown {
  const fieldName = `question_${question.id}`;

  switch (question.question_type) {
    case "multi_select":
      return formData.getAll(fieldName).map(String).filter(Boolean);
    case "checkbox":
    case "signature_acknowledgement":
      return formData.get(fieldName) === "true";
    case "number": {
      const raw = String(formData.get(fieldName) ?? "").trim();
      if (!raw) return "";
      const numberValue = Number(raw);
      return Number.isFinite(numberValue) ? numberValue : raw;
    }
    case "content":
      return null;
    default:
      return String(formData.get(fieldName) ?? "").trim();
  }
}

function isMissingRequiredAnswer(question: ApplicationQuestion, value: unknown) {
  if (!question.required || question.question_type === "content") return false;
  if (
    question.question_type === "checkbox" ||
    question.question_type === "signature_acknowledgement"
  ) {
    return value !== true;
  }
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined || String(value).trim() === "";
}

async function getEditableApplication(applicationId: string) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: application, error } = await supabase
    .from("applications")
    .select("id,applicant_user_id,status,form_version_id,current_stage_id,is_archived")
    .eq("id", applicationId)
    .single();

  if (error || !application) throw new Error("Application not found.");

  const canEdit =
    !application.is_archived &&
    (profile.role === "owner" ||
      (profile.role === "applicant" &&
        application.applicant_user_id === profile.id &&
        application.status === "draft"));

  if (!canEdit) throw new Error("This application is read-only.");
  if (!application.form_version_id) throw new Error("This application has no form version.");

  return { profile, supabase, application };
}

async function persistApplicationAnswers(
  applicationId: string,
  stageId: string,
  formData: FormData,
) {
  const { profile, supabase, application } = await getEditableApplication(applicationId);

  const { data: sectionData, error: sectionError } = await supabase
    .from("application_sections")
    .select("id")
    .eq("form_version_id", application.form_version_id)
    .eq("stage_id", stageId);
  if (sectionError) throw new Error(sectionError.message);
  const sectionIds = (sectionData ?? []).map((section) => section.id);

  if (sectionIds.length === 0) {
    throw new Error("This stage has no sections.");
  }

  const { data: questionData, error: questionError } = await supabase
    .from("application_questions")
    .select("id,form_version_id,section_id,question_key,label,description,question_type,required,options,settings,visibility_rule,sort_order,active,source_column_index,source_label,imported,created_at,updated_at")
    .eq("form_version_id", application.form_version_id)
    .eq("active", true)
    .in("section_id", sectionIds);
  if (questionError) throw new Error(questionError.message);

  const questions = (questionData ?? []) as ApplicationQuestion[];
  const answerMap = new Map<string, unknown>();
  const rows = questions
    .filter((question) => question.question_type !== "content")
    .map((question) => {
      const value = answerValue(question, formData);
      answerMap.set(question.id, value);
      return {
        application_id: applicationId,
        question_id: question.id,
        value,
        updated_by: profile.id,
      };
    });

  if (rows.length > 0) {
    const { error } = await supabase
      .from("application_answers")
      .upsert(rows, { onConflict: "application_id,question_id" });
    if (error) throw new Error(error.message);
  }

  return { supabase, application, questions, answerMap };
}

export async function saveApplicationAnswers(
  applicationId: string,
  stageId: string,
  formData: FormData,
) {
  await persistApplicationAnswers(applicationId, stageId, formData);
  revalidatePath(`/portal/applications/${applicationId}`);
  redirect(`/portal/applications/${applicationId}?stage=${stageId}&saved=1`);
}

export async function submitApplicationStage(
  applicationId: string,
  stageId: string,
  formData: FormData,
) {
  const { supabase, application, questions, answerMap } =
    await persistApplicationAnswers(applicationId, stageId, formData);

  const missing = questions.filter((question) =>
    isMissingRequiredAnswer(question, answerMap.get(question.id)),
  );
  if (missing.length > 0) {
    revalidatePath(`/portal/applications/${applicationId}`);
    redirect(
      `/portal/applications/${applicationId}?stage=${stageId}&error=required&missing=${missing.length}`,
    );
  }

  const { data: stages, error: stageError } = await supabase
    .from("application_stages")
    .select("id,sort_order")
    .eq("form_version_id", application.form_version_id)
    .eq("applicant_visible", true)
    .order("sort_order")
    .order("created_at");
  if (stageError) throw new Error(stageError.message);

  const stageIndex = (stages ?? []).findIndex((stage) => stage.id === stageId);
  const nextStage = stageIndex >= 0 ? stages?.[stageIndex + 1] : null;
  const now = new Date().toISOString();

  const { error: progressError } = await supabase
    .from("application_stage_progress")
    .upsert(
      {
        application_id: applicationId,
        stage_id: stageId,
        status: "complete",
        submitted_at: now,
        completed_at: now,
      },
      { onConflict: "application_id,stage_id" },
    );
  if (progressError) throw new Error(progressError.message);

  if (nextStage) {
    const { error: nextProgressError } = await supabase
      .from("application_stage_progress")
      .upsert(
        {
          application_id: applicationId,
          stage_id: nextStage.id,
          status: "in_progress",
          started_at: now,
        },
        { onConflict: "application_id,stage_id" },
      );
    if (nextProgressError) throw new Error(nextProgressError.message);

    const { error } = await supabase
      .from("applications")
      .update({ current_stage_id: nextStage.id, status: "draft" })
      .eq("id", applicationId);
    if (error) throw new Error(error.message);

    revalidatePath(`/portal/applications/${applicationId}`);
    redirect(`/portal/applications/${applicationId}?stage=${nextStage.id}&stage_submitted=1`);
  }

  const { error } = await supabase
    .from("applications")
    .update({ status: "submitted", submitted_at: now })
    .eq("id", applicationId);
  if (error) throw new Error(error.message);

  revalidatePath(`/portal/applications/${applicationId}`);
  revalidatePath("/portal/admin/applications");
  revalidatePath("/portal");
  redirect(`/portal/applications/${applicationId}?stage=${stageId}&submitted=1`);
}

export async function updateApplication(id: string, formData: FormData) {
  await requireProfile(["owner"]);
  const schoolName = String(formData.get("school_name") ?? "").trim();
  const productionTitle = String(formData.get("production_title") ?? "").trim();
  const status = String(formData.get("status") ?? "draft") as ApplicationStatus;
  const ownerNotes = String(formData.get("owner_notes") ?? "").trim();
  const currentStageId = String(formData.get("current_stage_id") ?? "").trim();

  if (!schoolName) throw new Error("School name is required.");

  const updatePayload: Record<string, unknown> = {
    school_name: schoolName,
    production_title: productionTitle || null,
    status,
    owner_notes: ownerNotes || null,
    current_stage_id: currentStageId || null,
  };
  if (status === "submitted") updatePayload.submitted_at = new Date().toISOString();
  if (status === "draft") updatePayload.submitted_at = null;

  const supabase = await createClient();
  const { error } = await supabase.from("applications").update(updatePayload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/portal/applications/${id}`);
  revalidatePath("/portal/admin/applications");
  revalidatePath("/portal");
}

export async function duplicateApplicationRecord(id: string, formData: FormData) {
  await requireProfile(["owner"]);
  const targetCycleId = String(formData.get("target_cycle_id") ?? "").trim();
  const copyAnswers = formData.get("copy_answers") === "on";
  if (!targetCycleId) throw new Error("Choose a target program.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_application_record", {
    p_source_application_id: id,
    p_target_cycle_id: targetCycleId,
    p_copy_answers: copyAnswers,
  });
  if (error) throw new Error(error.message);
  redirect(`/portal/applications/${String(data)}`);
}
