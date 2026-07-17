"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ApplicationStatus } from "@/lib/types";

export async function updateApplication(id: string, formData: FormData) {
  await requireProfile(["owner"]);
  const schoolName = String(formData.get("school_name") ?? "").trim();
  const productionTitle = String(formData.get("production_title") ?? "").trim();
  const status = String(formData.get("status") ?? "draft") as ApplicationStatus;
  const ownerNotes = String(formData.get("owner_notes") ?? "").trim();

  if (!schoolName) throw new Error("School name is required.");

  const supabase = await createClient();
  const { error } = await supabase.from("applications").update({
    school_name: schoolName,
    production_title: productionTitle || null,
    status,
    owner_notes: ownerNotes || null,
    submitted_at: status === "submitted" ? new Date().toISOString() : undefined,
  }).eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath(`/portal/applications/${id}`);
  revalidatePath("/portal/admin/applications");
  revalidatePath("/portal");
}
