"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function assignAdjudicator(formData: FormData) {
  await requireProfile(["owner"]);
  const applicationId = String(formData.get("application_id") ?? "").trim();
  const adjudicatorUserId = String(formData.get("adjudicator_user_id") ?? "").trim();
  const dueAt = String(formData.get("due_at") ?? "").trim();
  const internalNotes = String(formData.get("internal_notes") ?? "").trim();

  if (!applicationId || !adjudicatorUserId) {
    throw new Error("Choose both an application and an adjudicator.");
  }

  const supabase = await createClient();
  const { data: adjudicator, error: profileError } = await supabase
    .from("profiles")
    .select("id,role,active")
    .eq("id", adjudicatorUserId)
    .single();
  if (profileError || !adjudicator || adjudicator.role !== "adjudicator" || !adjudicator.active) {
    throw new Error("The selected user is not an active adjudicator.");
  }

  const { error } = await supabase.from("adjudicator_assignments").upsert(
    {
      application_id: applicationId,
      adjudicator_user_id: adjudicatorUserId,
      status: "assigned",
      due_at: dueAt || null,
      internal_notes: internalNotes || null,
    },
    { onConflict: "application_id,adjudicator_user_id" },
  );
  if (error) throw new Error(error.message);

  revalidatePath("/portal/admin/scoring");
  revalidatePath("/portal/admin/setup");
  revalidatePath("/portal/adjudication");
  redirect("/portal/admin/setup?tab=scoring&assigned=1");
}

export async function removeAdjudicatorAssignment(assignmentId: string) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.from("adjudicator_assignments").delete().eq("id", assignmentId);
  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/scoring");
  revalidatePath("/portal/admin/setup");
  revalidatePath("/portal/adjudication");
}

export async function saveAiPrompt(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const promptId = String(formData.get("prompt_id") ?? "").trim();
  const cycleId = String(formData.get("cycle_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const model = String(formData.get("model") ?? "gpt-5-mini").trim();
  const systemPrompt = String(formData.get("system_prompt") ?? "").trim();
  const userPromptTemplate = String(formData.get("user_prompt_template") ?? "").trim();

  if (!name || !model || !systemPrompt || !userPromptTemplate) {
    throw new Error("Complete every AI prompt field.");
  }

  const supabase = await createClient();
  const payload = {
    cycle_id: cycleId || null,
    template_key: "panel_category_comment",
    name,
    model,
    system_prompt: systemPrompt,
    user_prompt_template: userPromptTemplate,
    active: true,
    updated_by: owner.id,
  };

  if (promptId) {
    const { error } = await supabase.from("ai_prompt_templates").update(payload).eq("id", promptId);
    if (error) throw new Error(error.message);
  } else {
    let versionQuery = supabase
      .from("ai_prompt_templates")
      .select("version_number")
      .eq("template_key", "panel_category_comment");

    versionQuery = cycleId
      ? versionQuery.eq("cycle_id", cycleId)
      : versionQuery.is("cycle_id", null);

    const { data: current, error: versionError } = await versionQuery
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionError) throw new Error(versionError.message);

    const { error } = await supabase.from("ai_prompt_templates").insert({
      ...payload,
      version_number: (current?.version_number ?? 0) + 1,
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/portal/admin/scoring");
  revalidatePath("/portal/admin/setup");
  redirect("/portal/admin/setup?tab=scoring&prompt_saved=1");
}
