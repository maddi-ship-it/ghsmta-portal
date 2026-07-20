"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { sendSmtpEmail } from "@/lib/email/smtp";
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
  const supabase = await createClient();
  const now = new Date();

  const [{ data: setting }, { data: activities }] = await Promise.all([
    supabase
      .from("owner_digest_settings")
      .select("*")
      .eq("owner_user_id", owner.id)
      .maybeSingle(),
    supabase
      .from("owner_activity_log")
      .select("title,detail,created_at")
      .gte(
        "created_at",
        new Date(now.getTime() - 24 * 60 * 60_000).toISOString(),
      )
      .order("created_at", { ascending: false }),
  ]);

  const recipient = setting?.recipient_email || owner.email;
  if (!recipient) {
    finish(
      "error",
      "Add a recipient email to Daily Digest settings first.",
    );
  }

  const items = (activities ?? [])
    .map(
      (activity) =>
        `<li><strong>${activity.title}</strong>${
          activity.detail ? `<br>${activity.detail}` : ""
        }<br><small>${new Date(activity.created_at).toLocaleString(
          "en-US",
        )}</small></li>`,
    )
    .join("");

  const result = await sendSmtpEmail({
    to: [recipient],
    subject: `GHSMTA Owner daily review — ${now.toLocaleDateString("en-US")}`,
    text:
      (activities ?? [])
        .map(
          (activity) =>
            `${activity.title}${
              activity.detail ? ` — ${activity.detail}` : ""
            }`,
        )
        .join("\n") || "No review items were recorded in the last 24 hours.",
    html: `<h2>GHSMTA Owner daily review</h2>${
      items
        ? `<ul>${items}</ul>`
        : "<p>No review items were recorded in the last 24 hours.</p>"
    }`,
  });

  if (!result.ok) finish("error", result.detail);

  await supabase
    .from("owner_digest_settings")
    .update({ last_sent_at: now.toISOString() })
    .eq("owner_user_id", owner.id);

  await supabase.from("owner_activity_log").insert({
    activity_type: "digest_sent_manually",
    title: "Owner daily digest sent manually",
    detail: `Sent to ${recipient}.`,
    actor_user_id: owner.id,
  });

  revalidatePath("/portal/schedule");
  finish("success", `Daily digest sent to ${recipient}.`);
}
