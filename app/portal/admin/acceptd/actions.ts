"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  acceptdNumericId,
  refreshAcceptdSchema,
  syncAcceptdProgram,
} from "@/lib/acceptd/sync";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const SETUP_PATH = "/portal/admin/setup?tab=acceptd";

function requiredText(formData: FormData, key: string, label: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function schemaProgramIds(value: FormDataEntryValue | null) {
  const values = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.some((item) => !/^\d+$/.test(item) || Number(item) < 1)) {
    throw new Error("Schema source programs must be comma-separated numeric Acceptd IDs.");
  }
  return [...new Set(values.map(Number))];
}

export async function saveAcceptdProgramMapping(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const supabase = await createClient();
  const mappingId = String(formData.get("mapping_id") ?? "").trim();
  const acceptdProgramId = acceptdNumericId(formData.get("acceptd_program_id"), "Acceptd program ID");
  const portalCycleId = requiredText(formData, "portal_cycle_id", "Portal program");
  const portalFormVersionId = requiredText(formData, "portal_form_version_id", "Portal form");
  const { data: formVersion, error: formError } = await supabase
    .from("application_form_versions")
    .select("id,cycle_id")
    .eq("id", portalFormVersionId)
    .eq("cycle_id", portalCycleId)
    .maybeSingle();
  if (formError || !formVersion) {
    throw new Error(formError?.message ?? "The selected form does not belong to the selected program.");
  }
  const values = {
    acceptd_program_id: acceptdProgramId,
    acceptd_program_name: requiredText(formData, "acceptd_program_name", "Acceptd program name"),
    portal_cycle_id: portalCycleId,
    portal_form_version_id: portalFormVersionId,
    schema_source_program_ids: schemaProgramIds(formData.get("schema_source_program_ids")),
    enabled: formData.get("enabled") === "true",
    sync_drafts: formData.get("sync_drafts") === "true",
    updated_by: owner.id,
  };
  const query = mappingId
    ? supabase.from("acceptd_program_mappings").update(values).eq("id", mappingId)
    : supabase.from("acceptd_program_mappings").insert({ ...values, created_by: owner.id });
  const { error } = await query;
  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/setup");
  redirect(`${SETUP_PATH}&configured=1`);
}

export async function mapAcceptdUser(programMappingId: string, formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const supabase = await createClient();
  const acceptdUserId = acceptdNumericId(formData.get("acceptd_user_id"), "Acceptd user ID");
  const profileId = requiredText(formData, "portal_profile_id", "Portal applicant");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,role,active")
    .eq("id", profileId)
    .maybeSingle();
  if (profileError || !profile || profile.role !== "applicant" || !profile.active) {
    throw new Error(profileError?.message ?? "Choose an active portal applicant account.");
  }
  const { error } = await supabase.from("acceptd_user_mappings").upsert(
    {
      acceptd_user_id: acceptdUserId,
      portal_profile_id: profileId,
      acceptd_name: String(formData.get("acceptd_name") ?? "").trim() || null,
      acceptd_email: String(formData.get("acceptd_email") ?? "").trim() || null,
      mapped_by: owner.id,
    },
    { onConflict: "acceptd_user_id" },
  );
  if (error) throw new Error(error.message);
  await syncAcceptdProgram(programMappingId, "manual");
  revalidatePath("/portal/admin/setup");
  revalidatePath("/portal/admin/applications");
  redirect(`${SETUP_PATH}&mapped=1`);
}

export async function unmapAcceptdUser(mappingId: string) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.from("acceptd_user_mappings").delete().eq("id", mappingId);
  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/setup");
  redirect(`${SETUP_PATH}&unmapped=1`);
}

export async function syncAcceptdNow(mappingId: string) {
  await requireProfile(["owner"]);
  await syncAcceptdProgram(mappingId, "manual");
  revalidatePath("/portal/admin/setup");
  revalidatePath("/portal/admin/applications");
  redirect(`${SETUP_PATH}&synced=1`);
}

export async function refreshAcceptdQuestionSchema(mappingId: string) {
  await requireProfile(["owner"]);
  await refreshAcceptdSchema(mappingId);
  revalidatePath("/portal/admin/setup");
  redirect(`${SETUP_PATH}&schema_synced=1`);
}
