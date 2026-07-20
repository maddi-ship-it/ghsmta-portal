"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { sendOwnerDigestEmail } from "@/lib/email/owner-digest";
import { createClient } from "@/lib/supabase/server";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function finish(kind: "success" | "error", message: string): never {
  const params = new URLSearchParams({ section: "messages", [kind]: message });
  redirect(`/portal/schedule?${params.toString()}`);
}

export async function savePortalMessageTemplate(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const templateKey = text(formData, "template_key");
  const subjectTemplate = text(formData, "subject_template");
  const bodyTemplate = text(formData, "body_template");

  if (!templateKey || !subjectTemplate || !bodyTemplate) {
    finish("error", "Template subject and message are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("portal_message_templates")
    .update({
      subject_template: subjectTemplate,
      body_template: bodyTemplate,
      send_in_app: formData.get("send_in_app") === "on",
      send_school_messaging:
        formData.get("send_school_messaging") === "on",
      send_email: formData.get("send_email") === "on",
      active: formData.get("active") === "on",
      updated_by: owner.id,
    })
    .eq("template_key", templateKey);

  if (error) finish("error", error.message);
  revalidatePath("/portal/schedule");
  finish("success", "Message template saved.");
}

export async function sendOwnerDigestNow() {
  const owner = await requireProfile(["owner"]);

  try {
    const result = await sendOwnerDigestEmail(owner);
    revalidatePath("/portal/schedule");
    revalidatePath("/portal/admin/reports");
    finish(
      "success",
      `Daily digest sent to ${result.recipient}.`,
    );
  } catch (caught) {
    finish(
      "error",
      caught instanceof Error
        ? caught.message
        : "The daily digest could not be sent.",
    );
  }
}
