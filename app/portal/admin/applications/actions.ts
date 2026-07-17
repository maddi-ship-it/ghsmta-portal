"use server";

import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function startApplication(formData: FormData) {
  await requireProfile(["applicant"]);

  const schoolName = String(formData.get("school_name") ?? "").trim();
  const productionTitle = String(formData.get("production_title") ?? "").trim();

  if (!schoolName) {
    redirect("/portal/admin/applications?error=school_required");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_application", {
    p_school_name: schoolName,
    p_production_title: productionTitle || null,
  });

  if (error) {
    const message = encodeURIComponent(error.message);
    redirect(`/portal/admin/applications?error=start_failed&message=${message}`);
  }

  redirect(`/portal/applications/${String(data)}`);
}
