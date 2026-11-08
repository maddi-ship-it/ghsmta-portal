"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import {
  readScheduleWorkflowChecklist,
  writeScheduleWorkflowChecklist,
} from "@/lib/schedule-workflow-checklist";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function markSectionCReminderSent(applicationId: string) {
  const owner = await requireProfile(["owner"]);
  const admin = createAdminClient();
  const { data: application, error: applicationError } = await admin
    .from("applications")
    .select("id,form_data")
    .eq("id", applicationId)
    .maybeSingle();

  if (applicationError || !application) {
    throw new Error(
      applicationError?.message ?? "The school application could not be found.",
    );
  }

  const formData = application.form_data as Record<string, unknown> | null;
  const checklist = readScheduleWorkflowChecklist(formData);
  checklist.section_c_reminder_sent = true;
  const { error } = await admin
    .from("applications")
    .update({
      form_data: writeScheduleWorkflowChecklist(
        formData,
        checklist,
        owner.id,
      ),
    })
    .eq("id", applicationId);

  if (error) throw new Error(error.message);
  revalidatePath("/portal");
  revalidatePath("/portal/schedule");
  revalidatePath("/portal/admin/reports");
}
