"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

export async function updateUserRole(userId: string, formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const role = String(formData.get("role") ?? "applicant") as AppRole;
  if (owner.id === userId && role !== "owner") throw new Error("Owners cannot remove their own owner access.");
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/users");
}
