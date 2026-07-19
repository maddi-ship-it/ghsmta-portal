"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const SETUP_PATH = "/portal/admin/setup?tab=workflows";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function saveScheduleNotificationRule(formData: FormData) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const id = text(formData, "id");
  const name = text(formData, "name");
  const offsetMinutes = Number(text(formData, "offset_minutes"));
  const titleTemplate = text(formData, "title_template");
  const messageTemplate = text(formData, "message_template");
  if (!name || !Number.isFinite(offsetMinutes) || offsetMinutes < 0 || !titleTemplate || !messageTemplate) {
    throw new Error("Name, timing, title, and message are required.");
  }

  const payload = {
    name,
    cycle_id: text(formData, "cycle_id") || null,
    offset_minutes: Math.round(offsetMinutes),
    audience: text(formData, "audience") || "school",
    destination: text(formData, "destination") || "school_dm",
    title_template: titleTemplate,
    message_template: messageTemplate,
    active: formData.get("active") === "on",
  };

  const result = id
    ? await supabase.from("schedule_notification_rules").update(payload).eq("id", id)
    : await supabase.from("schedule_notification_rules").insert(payload);
  if (result.error) throw new Error(result.error.message);
  revalidatePath(SETUP_PATH);
}

export async function deleteScheduleNotificationRule(ruleId: string) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.from("schedule_notification_rules").delete().eq("id", ruleId);
  if (error) throw new Error(error.message);
  revalidatePath(SETUP_PATH);
}

export async function saveDigestSettings(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const supabase = await createClient();
  const deliveryHour = Number(text(formData, "delivery_hour"));
  if (!Number.isInteger(deliveryHour) || deliveryHour < 0 || deliveryHour > 23) {
    throw new Error("Choose a delivery hour between 0 and 23.");
  }
  const { error } = await supabase.from("owner_digest_settings").upsert({
    owner_user_id: owner.id,
    enabled: formData.get("enabled") === "on",
    delivery_hour: deliveryHour,
    time_zone: text(formData, "time_zone") || "America/New_York",
    include_empty: formData.get("include_empty") === "on",
    recipient_email: text(formData, "recipient_email") || owner.email,
  });
  if (error) throw new Error(error.message);
  revalidatePath(SETUP_PATH);
}

export async function assignScoringParticipant(formData: FormData) {
  await requireProfile(["owner"]);
  const applicationId = text(formData, "application_id");
  const userId = text(formData, "user_id");
  if (!applicationId || !userId) throw new Error("Choose an application and portal user.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("owner_set_scoring_participant", {
    p_application_id: applicationId,
    p_user_id: userId,
    p_can_score: formData.get("can_score") === "on",
    p_can_comment: formData.get("can_comment") === "on",
  });
  if (error) throw new Error(error.message);
  revalidatePath(SETUP_PATH);
  revalidatePath(`/portal/adjudication/${applicationId}`);
}

export async function updateFeedbackRequest(formData: FormData) {
  await requireProfile(["owner"]);
  const id = text(formData, "id");
  const supabase = await createClient();
  const { error } = await supabase
    .from("portal_feedback_requests")
    .update({
      status: text(formData, "status"),
      owner_notes: text(formData, "owner_notes") || null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(SETUP_PATH);
}
