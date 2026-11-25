"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { sendSmtpEmail } from "@/lib/email/smtp";
import { portalSiteUrl } from "@/lib/site-url";
import { sendStudentPortalSms } from "@/lib/student-notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/types";

const PATH = "/portal/admin/student-announcements";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function publishStudentAnnouncement(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const audience = String(formData.get("audience") ?? "students_and_guardians");
  const deliveryEmail = formData.get("delivery_email") === "on";
  const deliverySms = formData.get("delivery_sms") === "on";
  const deliveryInApp = formData.get("delivery_in_app") === "on";
  if (!title || !body) throw new Error("Announcement title and message are required.");

  const rolesByAudience: Record<string, AppRole[]> = {
    students: ["student", "guardian"],
    guardians: ["guardian"],
    students_and_guardians: ["student", "guardian"],
    alumni: ["alumni"],
    all_student_portal: ["student", "guardian", "alumni"],
  };
  const roles = rolesByAudience[audience];
  if (!roles) throw new Error("Choose a valid audience.");

  const admin = createAdminClient();
  const { data: announcement, error } = await admin.from("student_announcements").insert({ title, body, audience, delivery_email: deliveryEmail, delivery_sms: deliverySms, delivery_in_app: deliveryInApp, published_at: new Date().toISOString(), created_by: owner.id }).select("id").single();
  if (error || !announcement) throw new Error(error?.message ?? "Announcement could not be published.");
  const { data: recipients, error: recipientError } = await admin.from("profiles").select("id,email,phone_e164,notification_preferences,role").in("role", roles).eq("active", true);
  if (recipientError) throw new Error(recipientError.message);

  if (deliveryInApp && (recipients ?? []).length > 0) {
    await admin.from("user_notifications").insert((recipients ?? []).map((recipient) => ({ user_id: recipient.id, notification_type: "student_announcement", title, body: body.slice(0, 500), href: "/portal/notifications" })));
  }
  const siteUrl = portalSiteUrl();
  const results = await Promise.all((recipients ?? []).map(async (recipient) => {
    const preferences = (recipient.notification_preferences ?? {}) as { email?: boolean; sms?: boolean };
    const emailResult = deliveryEmail && preferences.email !== false && recipient.email ? await sendSmtpEmail({ to: [recipient.email], subject: title, text: `${body}\n\nOpen the GHSMTA Portal: ${siteUrl}/portal`, html: `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body).replaceAll("\n", "<br />")}</p><p><a href="${siteUrl}/portal">Open the GHSMTA Portal</a></p>` }) : null;
    const smsResult = deliverySms && preferences.sms !== false && recipient.phone_e164 ? await sendStudentPortalSms(recipient.phone_e164, `GHSMTA: ${title}\n${body}\n${siteUrl}/portal`) : null;
    return { email: emailResult?.ok ?? null, sms: smsResult?.ok ?? null };
  }));
  await admin.from("owner_activity_log").insert({ activity_type: "student_announcement_published", title: `Student announcement: ${title}`, detail: `${recipients?.length ?? 0} recipients`, actor_id: owner.id, metadata: { announcement_id: announcement.id, audience, recipients: recipients?.length ?? 0, email_sent: results.filter((result) => result.email).length, sms_sent: results.filter((result) => result.sms).length } });
  revalidatePath(PATH);
  redirect(`${PATH}?published=${recipients?.length ?? 0}`);
}
