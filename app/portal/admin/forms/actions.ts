"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ApplicationQuestionType } from "@/lib/types";

const QUESTION_TYPES: ApplicationQuestionType[] = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
  "date",
  "datetime",
  "select",
  "multi_select",
  "radio",
  "checkbox",
  "yes_no",
  "signature_acknowledgement",
  "content",
];

function slugifyQuestionKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

function parseOptions(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSortOrder(value: FormDataEntryValue | null): number {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function createFormVersion(formData: FormData) {
  await requireProfile(["owner"]);

  const cycleId = String(formData.get("cycle_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!cycleId || !name) {
    throw new Error("Cycle and form name are required.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_form_version", {
    p_cycle_id: cycleId,
    p_name: name,
  });

  if (error) throw new Error(error.message);
  redirect(`/portal/admin/forms/${String(data)}`);
}

export async function publishFormVersion(formVersionId: string) {
  await requireProfile(["owner"]);

  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_form_version", {
    target_form_version_id: formVersionId,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/portal/admin/forms");
  revalidatePath("/portal/admin/setup");
  revalidatePath(`/portal/admin/forms/${formVersionId}`);
}

export async function createSection(formVersionId: string, formData: FormData) {
  await requireProfile(["owner"]);

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const sortOrder = parseSortOrder(formData.get("sort_order"));
  const stageId = String(formData.get("stage_id") ?? "").trim();

  if (!title) throw new Error("Section title is required.");

  const supabase = await createClient();
  const { error } = await supabase.from("application_sections").insert({
    form_version_id: formVersionId,
    stage_id: stageId || null,
    title,
    description: description || null,
    sort_order: sortOrder,
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/portal/admin/forms/${formVersionId}`);
}

export async function updateSection(
  formVersionId: string,
  sectionId: string,
  formData: FormData,
) {
  await requireProfile(["owner"]);

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const sortOrder = parseSortOrder(formData.get("sort_order"));
  const stageId = String(formData.get("stage_id") ?? "").trim();

  if (!title) throw new Error("Section title is required.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("application_sections")
    .update({
      stage_id: stageId || null,
      title,
      description: description || null,
      sort_order: sortOrder,
    })
    .eq("id", sectionId)
    .eq("form_version_id", formVersionId);

  if (error) throw new Error(error.message);
  revalidatePath(`/portal/admin/forms/${formVersionId}`);
}

export async function createQuestion(formVersionId: string, formData: FormData) {
  await requireProfile(["owner"]);

  const sectionId = String(formData.get("section_id") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const suppliedKey = String(formData.get("question_key") ?? "").trim();
  const questionKey = slugifyQuestionKey(suppliedKey || label);
  const description = String(formData.get("description") ?? "").trim();
  const questionType = String(
    formData.get("question_type") ?? "short_text",
  ) as ApplicationQuestionType;
  const required = formData.get("required") === "on";
  const sortOrder = parseSortOrder(formData.get("sort_order"));
  const externalUrl = String(formData.get("external_url") ?? "").trim();
  const placeholder = String(formData.get("placeholder") ?? "").trim();
  const acknowledgementLabel = String(
    formData.get("acknowledgement_label") ?? "",
  ).trim();

  if (!sectionId || !label || !questionKey) {
    throw new Error("Section, label, and question key are required.");
  }

  if (!QUESTION_TYPES.includes(questionType)) {
    throw new Error("Invalid question type.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("application_questions").insert({
    form_version_id: formVersionId,
    section_id: sectionId,
    question_key: questionKey,
    label,
    description: description || null,
    question_type: questionType,
    required,
    options: parseOptions(formData.get("options")),
    settings: {
      ...(externalUrl ? { external_url: externalUrl } : {}),
      ...(placeholder ? { placeholder } : {}),
      ...(acknowledgementLabel
        ? { acknowledgement_label: acknowledgementLabel }
        : {}),
    },
    sort_order: sortOrder,
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/portal/admin/forms/${formVersionId}`);
}

export async function updateQuestion(
  formVersionId: string,
  questionId: string,
  formData: FormData,
) {
  await requireProfile(["owner"]);

  const label = String(formData.get("label") ?? "").trim();
  const questionKey = slugifyQuestionKey(
    String(formData.get("question_key") ?? ""),
  );
  const description = String(formData.get("description") ?? "").trim();
  const questionType = String(
    formData.get("question_type") ?? "short_text",
  ) as ApplicationQuestionType;
  const required = formData.get("required") === "on";
  const active = formData.get("active") === "on";
  const sortOrder = parseSortOrder(formData.get("sort_order"));
  const externalUrl = String(formData.get("external_url") ?? "").trim();
  const placeholder = String(formData.get("placeholder") ?? "").trim();
  const acknowledgementLabel = String(
    formData.get("acknowledgement_label") ?? "",
  ).trim();

  if (!label || !questionKey) {
    throw new Error("Question label and key are required.");
  }

  if (!QUESTION_TYPES.includes(questionType)) {
    throw new Error("Invalid question type.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("application_questions")
    .update({
      label,
      question_key: questionKey,
      description: description || null,
      question_type: questionType,
      required,
      active,
      options: parseOptions(formData.get("options")),
      settings: {
        ...(externalUrl ? { external_url: externalUrl } : {}),
        ...(placeholder ? { placeholder } : {}),
        ...(acknowledgementLabel
          ? { acknowledgement_label: acknowledgementLabel }
          : {}),
      },
      sort_order: sortOrder,
    })
    .eq("id", questionId)
    .eq("form_version_id", formVersionId);

  if (error) throw new Error(error.message);
  revalidatePath(`/portal/admin/forms/${formVersionId}`);
}

export async function deleteQuestion(formVersionId: string, questionId: string) {
  await requireProfile(["owner"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("application_questions")
    .delete()
    .eq("id", questionId)
    .eq("form_version_id", formVersionId);

  if (error) throw new Error(error.message);
  revalidatePath(`/portal/admin/forms/${formVersionId}`);
}


export async function createStage(formVersionId: string, formData: FormData) {
  await requireProfile(["owner"]);

  const title = String(formData.get("title") ?? "").trim();
  const suppliedKey = String(formData.get("stage_key") ?? "").trim();
  const stageKey = slugifyQuestionKey(suppliedKey || title);
  const description = String(formData.get("description") ?? "").trim();
  const sortOrder = parseSortOrder(formData.get("sort_order"));
  const isInitial = formData.get("is_initial") === "on";

  if (!title || !stageKey) throw new Error("Stage title and key are required.");

  const supabase = await createClient();
  if (isInitial) {
    const { error: clearError } = await supabase
      .from("application_stages")
      .update({ is_initial: false })
      .eq("form_version_id", formVersionId);
    if (clearError) throw new Error(clearError.message);
  }

  const { error } = await supabase.from("application_stages").insert({
    form_version_id: formVersionId,
    stage_key: stageKey,
    title,
    description: description || null,
    sort_order: sortOrder,
    is_initial: isInitial,
    applicant_visible: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/portal/admin/forms/${formVersionId}`);
}

export async function updateStage(
  formVersionId: string,
  stageId: string,
  formData: FormData,
) {
  await requireProfile(["owner"]);

  const title = String(formData.get("title") ?? "").trim();
  const stageKey = slugifyQuestionKey(String(formData.get("stage_key") ?? title));
  const description = String(formData.get("description") ?? "").trim();
  const sortOrder = parseSortOrder(formData.get("sort_order"));
  const isInitial = formData.get("is_initial") === "on";
  const applicantVisible = formData.get("applicant_visible") === "on";

  if (isInitial) {
    const supabase = await createClient();
    const { error: clearError } = await supabase
      .from("application_stages")
      .update({ is_initial: false })
      .eq("form_version_id", formVersionId)
      .neq("id", stageId);
    if (clearError) throw new Error(clearError.message);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("application_stages")
    .update({
      stage_key: stageKey,
      title,
      description: description || null,
      sort_order: sortOrder,
      is_initial: isInitial,
      applicant_visible: applicantVisible,
    })
    .eq("id", stageId)
    .eq("form_version_id", formVersionId);
  if (error) throw new Error(error.message);
  revalidatePath(`/portal/admin/forms/${formVersionId}`);
}

export async function duplicateFormVersion(
  sourceFormVersionId: string,
  formData: FormData,
) {
  await requireProfile(["owner"]);
  const targetCycleId = String(formData.get("target_cycle_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!targetCycleId) throw new Error("Choose a target program.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_form_version", {
    p_source_form_version_id: sourceFormVersionId,
    p_target_cycle_id: targetCycleId,
    p_name: name || null,
  });
  if (error) throw new Error(error.message);
  redirect(`/portal/admin/forms/${String(data)}`);
}

export async function editPublishedFormVersion(sourceFormVersionId: string) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { data: source, error: sourceError } = await supabase
    .from("application_form_versions")
    .select("cycle_id,name,status")
    .eq("id", sourceFormVersionId)
    .single();
  if (sourceError || !source) throw new Error(sourceError?.message ?? "Published form not found.");
  if (source.status !== "published") redirect(`/portal/admin/forms/${sourceFormVersionId}`);
  const { data, error } = await supabase.rpc("duplicate_form_version", {
    p_source_form_version_id: sourceFormVersionId,
    p_target_cycle_id: source.cycle_id,
    p_name: `${source.name} — Updated draft`,
  });
  if (error) throw new Error(error.message);
  redirect(`/portal/admin/forms/${String(data)}`);
}
