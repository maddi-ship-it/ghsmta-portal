"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function archiveSchoolFile(formData: FormData) {
  await requireProfile();
  const fileId = String(formData.get("file_id") ?? "").trim();

  if (!fileId) {
    throw new Error("School file not found.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_school_file", {
    p_file_id: fileId,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/portal/files");
}
