import { sendSmtpEmail } from "@/lib/email/smtp";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type ChannelMember = {
  user_id: string;
  display_name: string;
  user_role: string;
};

type RecipientProfile = {
  id: string;
  email: string | null;
  notification_preferences: {
    email?: boolean;
  } | null;
};

type ChatChannel = {
  id: string;
  channel_type: string;
  name: string;
  application_id: string | null;
  applications:
    | {
        school_name: string | null;
        production_title: string | null;
        external_applicant_email: string | null;
      }
    | Array<{
        school_name: string | null;
        production_title: string | null;
        external_applicant_email: string | null;
      }>
    | null;
};

function siteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  ).replace(/\/$/, "");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1).trimEnd()}…`
    : value;
}

function channelLabel(channel: ChatChannel) {
  const application = channelApplication(channel);

  if (channel.channel_type === "school_dm") {
    return application?.school_name
      ? `${application.school_name} — School Messaging`
      : "School Messaging";
  }

  if (channel.channel_type === "school") {
    return application?.school_name
      ? `${application.school_name} — Panel Channel`
      : "Panel Channel";
  }

  if (channel.channel_type === "scholarship_dm") {
    return application?.school_name
      ? `${application.school_name} — Scholarship Requests`
      : "Scholarship Requests";
  }

  return channel.name || "Chat";
}

function channelApplication(channel: ChatChannel) {
  return Array.isArray(channel.applications)
    ? channel.applications[0]
    : channel.applications;
}

export async function sendChatEmailNotifications({
  channelId,
  messageId,
  messageKind,
  authorId,
  authorName,
  subject,
  body,
}: {
  channelId: string;
  messageId: string;
  messageKind: "post" | "reply";
  authorId: string;
  authorName: string;
  subject: string;
  body: string;
}) {
  const supabase = await createClient();
  const admin = createAdminClient();
  const logDelivery = async (
    status: "sent" | "skipped_no_recipients" | "failed",
    recipientCount: number,
    detail: string,
  ) => {
    try {
      await admin.from("chat_email_delivery_log").insert({
        channel_id: channelId,
        message_id: messageId,
        message_kind: messageKind,
        author_id: authorId,
        status,
        recipient_count: recipientCount,
        detail: detail.slice(0, 1000),
      });
    } catch {
      // Logging is best-effort; email delivery should not depend on the audit table.
    }
  };

  const [
    { data: members, error: memberError },
    { data: channel },
    { data: author },
  ] = await Promise.all([
    supabase.rpc("get_chat_channel_members", { p_channel_id: channelId }),
    admin
      .from("chat_channels")
      .select("id,channel_type,name,application_id,applications(school_name,production_title,external_applicant_email)")
      .eq("id", channelId)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("email")
      .eq("id", authorId)
      .maybeSingle(),
  ]);
  if (memberError) {
    await logDelivery("failed", 0, memberError.message);
    throw new Error(`Chat email channel members could not be loaded: ${memberError.message}`);
  }

  const recipientIds = [
    ...new Set(
      ((members ?? []) as ChannelMember[])
        .map((member) => member.user_id)
        .filter((id) => id !== authorId),
    ),
  ];

  const { data: profiles, error: profileError } = recipientIds.length > 0
    ? await admin
        .from("profiles")
        .select("id,email,notification_preferences")
        .in("id", recipientIds)
        .eq("active", true)
    : { data: [], error: null };
  if (profileError) {
    await logDelivery("failed", 0, profileError.message);
    throw new Error(`Chat email recipients could not be loaded: ${profileError.message}`);
  }

  const recipients = ((profiles ?? []) as RecipientProfile[])
    .filter((profile) => profile.email)
    .filter((profile) => profile.notification_preferences?.email !== false)
    .map((profile) => profile.email as string);

  const safeChannel = channel as ChatChannel | null;
  const label = safeChannel ? channelLabel(safeChannel) : "Chat";
  const application = safeChannel ? channelApplication(safeChannel) : null;
  const externalApplicantEmail =
    safeChannel?.channel_type &&
    ["school_dm", "scholarship_dm"].includes(safeChannel.channel_type)
      ? application?.external_applicant_email?.trim().toLowerCase() ?? ""
      : "";
  const recipientSet = new Set(
    recipients
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  const authorEmail = author?.email?.trim().toLowerCase();
  if (
    externalApplicantEmail &&
    externalApplicantEmail !== authorEmail &&
    !recipientSet.has(externalApplicantEmail)
  ) {
    recipientSet.add(externalApplicantEmail);
  }
  const finalRecipients = [...recipientSet];

  if (finalRecipients.length === 0) {
    await logDelivery(
      "skipped_no_recipients",
      0,
      "Channel members had no eligible email recipients after preferences and sender exclusion.",
    );
    return;
  }

  const chatUrl = `${siteUrl()}/portal/chat?channel=${channelId}`;
  const preview = truncate(body.replace(/\s+/g, " ").trim(), 500);
  const emailSubject = `New chat message — ${label}`;
  const emailText = `${authorName} posted in ${label}.\n\n${subject}\n\n${preview}\n\nOpen Chat: ${chatUrl}`;
  const emailHtml = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">
      <h2>New chat message</h2>
      <p><strong>${escapeHtml(authorName)}</strong> posted in ${escapeHtml(label)}.</p>
      <p><strong>${escapeHtml(subject)}</strong></p>
      <p>${escapeHtml(preview).replaceAll("\n", "<br />")}</p>
      <p><a href="${escapeHtml(chatUrl)}" style="display:inline-block;padding:12px 18px;background:#153f8f;color:#fff;text-decoration:none;border-radius:8px">Open Chat</a></p>
      <p style="color:#5d6678;font-size:13px">You received this because email notifications are enabled in your GHSMTA Portal account settings.</p>
    </div>
  `;

  const results = await Promise.all(
    finalRecipients.map((recipient) =>
      sendSmtpEmail({
        to: [recipient],
        subject: emailSubject,
        text: emailText,
        html: emailHtml,
      }),
    ),
  );
  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    await logDelivery(
      "failed",
      finalRecipients.length,
      failures.map((failure) => failure.detail).join("; "),
    );
    throw new Error(
      `Chat email notification failed for ${failures.length} recipient(s): ${failures
        .map((failure) => failure.detail)
        .join("; ")}`,
    );
  }
  await logDelivery("sent", finalRecipients.length, "Chat email notification sent.");
}
