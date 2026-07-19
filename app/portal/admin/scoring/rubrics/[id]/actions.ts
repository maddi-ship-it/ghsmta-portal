"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function integer(formData: FormData, key: string, fallback: number) {
  const value = Number(text(formData, key));
  return Number.isInteger(value) ? value : fallback;
}

async function requireDraftRubric(rubricId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scoring_rubrics")
    .select("id,status")
    .eq("id", rubricId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Rubric not found.");
  if (data.status !== "draft") throw new Error("Published and archived rubrics are read-only. Duplicate this rubric to edit it.");
  return supabase;
}

function refresh(rubricId: string) {
  revalidatePath(`/portal/admin/scoring/rubrics/${rubricId}`);
  revalidatePath("/portal/admin/scoring");
  revalidatePath("/portal/admin/setup");
}

export async function updateRubric(rubricId: string, formData: FormData) {
  await requireProfile(["owner"]);
  const supabase = await requireDraftRubric(rubricId);
  const scoreMin = Number(text(formData, "score_min"));
  const scoreMax = Number(text(formData, "score_max"));
  if (!Number.isFinite(scoreMin) || !Number.isFinite(scoreMax) || scoreMin >= scoreMax) {
    throw new Error("Enter a valid score minimum and maximum.");
  }
  const { error } = await supabase.from("scoring_rubrics").update({
    name: text(formData, "name"),
    score_min: scoreMin,
    score_max: scoreMax,
  }).eq("id", rubricId);
  if (error) throw new Error(error.message);
  refresh(rubricId);
}

export async function duplicateRubricVersion(rubricId: string, formData: FormData) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_scoring_rubric_version", {
    p_source_rubric_id: rubricId,
    p_name: text(formData, "copy_name") || null,
  });
  if (error) throw new Error(error.message);
  redirect(`/portal/admin/scoring/rubrics/${String(data)}`);
}

export async function publishRubric(rubricId: string) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_scoring_rubric", { p_rubric_id: rubricId });
  if (error) throw new Error(error.message);
  refresh(rubricId);
  redirect(`/portal/admin/scoring/rubrics/${rubricId}?published=1`);
}

export async function createCategory(rubricId: string, formData: FormData) {
  await requireProfile(["owner"]);
  const supabase = await requireDraftRubric(rubricId);
  const title = text(formData, "title");
  if (!title) throw new Error("Enter a category title.");
  const { data: last } = await supabase.from("scoring_categories").select("sort_order").eq("rubric_id", rubricId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const categoryKey = text(formData, "category_key") || title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const { error } = await supabase.from("scoring_categories").insert({
    rubric_id: rubricId,
    category_key: categoryKey,
    title,
    description: text(formData, "description") || null,
    guidance: text(formData, "guidance") || null,
    subject_label: text(formData, "subject_label") || null,
    sort_order: Number(last?.sort_order ?? 0) + 10,
    required: formData.get("required") === "on",
    allow_not_applicable: formData.get("allow_not_applicable") === "on",
    active: true,
  });
  if (error) throw new Error(error.message);
  refresh(rubricId);
}

export async function updateCategory(rubricId: string, categoryId: string, formData: FormData) {
  await requireProfile(["owner"]);
  const supabase = await requireDraftRubric(rubricId);
  const { error } = await supabase.from("scoring_categories").update({
    title: text(formData, "title"),
    category_key: text(formData, "category_key"),
    description: text(formData, "description") || null,
    guidance: text(formData, "guidance") || null,
    subject_label: text(formData, "subject_label") || null,
    sort_order: integer(formData, "sort_order", 0),
    required: formData.get("required") === "on",
    allow_not_applicable: formData.get("allow_not_applicable") === "on",
    active: formData.get("active") === "on",
  }).eq("id", categoryId).eq("rubric_id", rubricId);
  if (error) throw new Error(error.message);
  refresh(rubricId);
}

export async function createCriterion(rubricId: string, categoryId: string, formData: FormData) {
  await requireProfile(["owner"]);
  const supabase = await requireDraftRubric(rubricId);
  const title = text(formData, "title");
  if (!title) throw new Error("Enter a criterion title.");
  const { data: last } = await supabase.from("scoring_criteria").select("sort_order").eq("category_id", categoryId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const criterionKey = text(formData, "criterion_key") || title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const { error } = await supabase.from("scoring_criteria").insert({
    category_id: categoryId,
    criterion_key: criterionKey,
    title,
    description: text(formData, "description") || null,
    weight: Number(text(formData, "weight") || "1"),
    sort_order: Number(last?.sort_order ?? 0) + 10,
    active: true,
  });
  if (error) throw new Error(error.message);
  refresh(rubricId);
}

export async function updateCriterion(rubricId: string, criterionId: string, formData: FormData) {
  await requireProfile(["owner"]);
  const supabase = await requireDraftRubric(rubricId);
  const { error } = await supabase.from("scoring_criteria").update({
    title: text(formData, "title"),
    criterion_key: text(formData, "criterion_key"),
    description: text(formData, "description") || null,
    weight: Number(text(formData, "weight") || "1"),
    sort_order: integer(formData, "sort_order", 0),
    active: formData.get("active") === "on",
  }).eq("id", criterionId);
  if (error) throw new Error(error.message);
  refresh(rubricId);
}
