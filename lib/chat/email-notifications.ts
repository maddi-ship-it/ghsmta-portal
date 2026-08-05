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
      }
    | Array<{
        school_name: string | null;
        production_title: string | null;
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
  const application = Array.isArray(channel.applications)
    ? channel.applications[0]
    : channel.applications;

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

export async function sendChatEmailNotifications({
  channelId,
  authorId,
  authorName,
  subject,
  body,
}: {
  channelId: string;
  authorId: string;
  authorName: string;
  subject: string;
  body: string;
}) {
  const supabase = await createClient();
  const admin = createAdminClient();
  const [{ data: members }, { data: channel }] = await Promise.all([
    supabase.rpc("get_chat_channel_members", { p_channel_id: channelId }),
    admin
      .from("chat_channels")
      .select("id,channel_type,name,application_id,applications(school_name,production_title)")
      .eq("id", channelId)
      .maybeSingle(),
  ]);

  const recipientIds = [
    ...new Set(
      ((members ?? []) as ChannelMember[])
        .map((member) => member.user_id)
        .filter((id) => id !== authorId),
    ),
  ];
  if (recipientIds.length === 0) return;

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id,email,notification_preferences")
    .in("id", recipientIds)
    .eq("active", true);
  if (profileError) {
    throw new Error(`Chat email recipients could not be loaded: ${profileError.message}`);
  }

  const recipients = ((profiles ?? []) as RecipientProfile[])
    .filter((profile) => profile.email)
    .filter((profile) => profile.notification_preferences?.email !== false)
    .map((profile) => profile.email as string);

  if (recipients.length === 0) return;

  const safeChannel = channel as ChatChannel | null;
  const label = safeChannel ? channelLabel(safeChannel) : "Chat";
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

  const result = await sendSmtpEmail({
    to: recipients,
    subject: emailSubject,
    text: emailText,
    html: emailHtml,
  });
  if (!result.ok) {
    throw new Error(`Chat email notification failed: ${result.detail}`);
  }
}
