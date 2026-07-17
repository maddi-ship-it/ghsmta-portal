"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ProgramType } from "@/lib/types";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createCycle(formData: FormData) {
  await requireProfile(["owner"]);

  const name = String(formData.get("name") ?? "").trim();
  const seasonYear = String(formData.get("season_year") ?? "").trim();
  const suppliedKey = String(formData.get("cycle_key") ?? "").trim();
  const programType = String(
    formData.get("program_type") ?? "directors",
  ) as ProgramType;
  const description = String(formData.get("description") ?? "").trim();
  const opensAt = String(formData.get("opens_at") ?? "");
  const closesAt = String(formData.get("closes_at") ?? "");
  const openImmediately = formData.get("open_immediately") === "on";

  if (!name || !seasonYear) {
    throw new Error("Program name and season year are required.");
  }

  const cycleKey = slugify(suppliedKey || `${seasonYear}-${programType}-${name}`);
  const supabase = await createClient();
  const { error } = await supabase.from("award_cycles").insert({
    cycle_key: cycleKey,
    name,
    season_year: seasonYear,
    program_type: programType,
    description: description || null,
    opens_at: opensAt ? new Date(opensAt).toISOString() : null,
    closes_at: closesAt ? new Date(closesAt).toISOString() : null,
    is_active: openImmediately,
    status: openImmediately ? "open" : "draft",
  });

  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/cycles");
  revalidatePath("/portal/admin/forms");
  revalidatePath("/portal/admin/applications");
}

export async function activateCycle(id: string) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_award_cycle", {
    target_cycle_id: id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/cycles");
  revalidatePath("/portal/admin/applications");
}

export async function deactivateCycle(id: string) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("deactivate_award_cycle", {
    target_cycle_id: id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/cycles");
  revalidatePath("/portal/admin/applications");
}

export async function duplicateCycle(sourceCycleId: string, formData: FormData) {
  await requireProfile(["owner"]);

  const name = String(formData.get("name") ?? "").trim();
  const seasonYear = String(formData.get("season_year") ?? "").trim();
  const cycleKey = slugify(String(formData.get("cycle_key") ?? "").trim());
  const programType = String(formData.get("program_type") ?? "").trim();

  if (!name || !seasonYear || !cycleKey) {
    throw new Error("Name, season year, and cycle key are required.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_application_program", {
    p_source_cycle_id: sourceCycleId,
    p_name: name,
    p_season_year: seasonYear,
    p_cycle_key: cycleKey,
    p_program_type: programType || null,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/cycles");
  revalidatePath("/portal/admin/forms");
  redirect(`/portal/admin/forms?cycle=${String(data)}`);
}
