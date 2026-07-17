"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function createCycle(formData: FormData) {
  await requireProfile(["owner"]);
  const name = String(formData.get("name") ?? "").trim();
  const seasonYear = String(formData.get("season_year") ?? "").trim();
  const opensAt = String(formData.get("opens_at") ?? "");
  const closesAt = String(formData.get("closes_at") ?? "");
  if (!name || !seasonYear) throw new Error("Cycle name and season year are required.");

  const supabase = await createClient();
  const { error } = await supabase.from("award_cycles").insert({
    name,
    season_year: seasonYear,
    opens_at: opensAt ? new Date(opensAt).toISOString() : null,
    closes_at: closesAt ? new Date(closesAt).toISOString() : null,
    is_active: false,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/cycles");
}

export async function activateCycle(id: string) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_award_cycle", { target_cycle_id: id });
  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/cycles");
}
