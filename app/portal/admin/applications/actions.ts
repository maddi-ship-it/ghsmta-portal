"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function startApplication(formData: FormData) {
  await requireProfile(["applicant"]);

  const cycleId = String(formData.get("cycle_id") ?? "").trim();
  const schoolName = String(formData.get("school_name") ?? "").trim();
  const productionTitle = String(formData.get("production_title") ?? "").trim();

  if (!cycleId) {
    redirect("/portal/admin/applications?error=program_required");
  }
  if (!schoolName) {
    redirect("/portal/admin/applications?error=school_required");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_application", {
    p_cycle_id: cycleId,
    p_school_name: schoolName,
    p_production_title: productionTitle || null,
  });

  if (error) {
    const message = encodeURIComponent(error.message);
    redirect(`/portal/admin/applications?error=start_failed&message=${message}`);
  }

  redirect(`/portal/applications/${String(data)}`);
}

export async function duplicateApplication(
  sourceApplicationId: string,
  formData: FormData,
) {
  await requireProfile(["owner"]);

  const targetCycleId = String(formData.get("target_cycle_id") ?? "").trim();
  const copyAnswers = formData.get("copy_answers") === "on";
  if (!targetCycleId) throw new Error("Choose a target program.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_application_record", {
    p_source_application_id: sourceApplicationId,
    p_target_cycle_id: targetCycleId,
    p_copy_answers: copyAnswers,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/applications");
  redirect(`/portal/applications/${String(data)}`);
}

export async function setApplicationArchiveState(formData: FormData) {
  await requireProfile(["owner"]);

  const singleArchiveId = String(formData.get("single_archive_id") ?? "").trim();
  const singleRestoreId = String(formData.get("single_restore_id") ?? "").trim();
  const bulkAction = String(formData.get("bulk_archive_action") ?? "").trim();
  const selected = [...new Set(formData.getAll("application_ids").map(String).filter(Boolean))];

  const applicationIds = singleArchiveId
    ? [singleArchiveId]
    : singleRestoreId
      ? [singleRestoreId]
      : selected;
  const archived = singleArchiveId ? true : singleRestoreId ? false : bulkAction === "archive";

  if (applicationIds.length === 0) throw new Error("Select at least one application.");
  if (!singleArchiveId && !singleRestoreId && !["archive", "restore"].includes(bulkAction)) {
    throw new Error("Choose Archive or Restore.");
  }

  const reason = String(formData.get("archive_reason") ?? "").trim();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_application_archive_state", {
    p_application_ids: applicationIds,
    p_archived: archived,
    p_reason: reason || null,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/applications");
  revalidatePath("/portal/adjudication");
  revalidatePath("/portal/chat");
  redirect(`/portal/admin/applications?${archived ? "archived" : "restored"}=${Number(data ?? applicationIds.length)}`);
}
