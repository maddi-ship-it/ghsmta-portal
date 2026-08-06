import { sendSmtpEmail } from "@/lib/email/smtp";
import { createAdminClient } from "@/lib/supabase/admin";

type RecipientProfile = {
  id: string;
  email: string | null;
  notification_preferences: {
    email?: boolean;
  } | null;
};

type AdminClient = ReturnType<typeof createAdminClient>;

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

  if (channel.channel_type === "direct_message") {
    return channel.name || "Direct Chat";
  }

  if (channel.channel_type === "group_direct_message") {
    return channel.name || "Group Chat";
  }

  return channel.name || "Chat";
}

function channelApplication(channel: ChatChannel) {
  return Array.isArray(channel.applications)
    ? channel.applications[0]
    : channel.applications;
}

function addIds(
  recipientIds: Set<string>,
  ids: Array<string | null | undefined>,
) {
  ids.filter((id): id is string => Boolean(id)).forEach((id) => {
    recipientIds.add(id);
  });
}

async function addActiveRoleRecipients(
  admin: AdminClient,
  recipientIds: Set<string>,
  roles: string[],
) {
  const query = admin.from("profiles").select("id").eq("active", true);
  const { data, error } =
    roles.length === 1
      ? await query.eq("role", roles[0])
      : await query.in("role", roles);

  if (error) {
    throw new Error(
      `Chat email role recipients could not be loaded: ${error.message}`,
    );
  }

  addIds(recipientIds, (data ?? []).map((profile) => profile.id));
}

async function addApplicationApplicantRecipients(
  admin: AdminClient,
  recipientIds: Set<string>,
  applicationId: string | null,
) {
  if (!applicationId) return;

  const { data: members, error: memberError } = await admin
    .from("application_members")
    .select("user_id")
    .eq("application_id", applicationId)
    .eq("active", true);

  if (memberError) {
    throw new Error(
      `Chat email school members could not be loaded: ${memberError.message}`,
    );
  }

  const memberIds = [
    ...new Set(
      (members ?? [])
        .map((member) => member.user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (memberIds.length === 0) return;

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .in("id", memberIds)
    .eq("active", true)
    .eq("role", "applicant");

  if (profileError) {
    throw new Error(
      `Chat email school profiles could not be loaded: ${profileError.message}`,
    );
  }

  addIds(recipientIds, (profiles ?? []).map((profile) => profile.id));
}

async function addPanelRecipients(
  admin: AdminClient,
  recipientIds: Set<string>,
  applicationId: string | null,
) {
  if (!applicationId) return;

  const { data: assignments, error: assignmentError } = await admin
    .from("adjudicator_assignments")
    .select("adjudicator_user_id")
    .eq("application_id", applicationId)
    .is("removed_at", null);

  if (assignmentError) {
    throw new Error(
      `Chat email assignments could not be loaded: ${assignmentError.message}`,
    );
  }

  addIds(
    recipientIds,
    (assignments ?? []).map((assignment) => assignment.adjudicator_user_id),
  );

  const { data: bookings, error: bookingError } = await admin
    .from("schedule_school_bookings")
    .select("slot_id")
    .eq("application_id", applicationId);

  if (bookingError) {
    throw new Error(
      `Chat email schedule bookings could not be loaded: ${bookingError.message}`,
    );
  }

  const slotIds = [
    ...new Set(
      (bookings ?? [])
        .map((booking) => booking.slot_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (slotIds.length === 0) return;

  const { data: slotStaff, error: staffError } = await admin
    .from("schedule_slot_staff")
    .select("user_id")
    .in("slot_id", slotIds)
    .in("joined_as", ["adjudicator", "advisory_member"]);

  if (staffError) {
    throw new Error(
      `Chat email schedule staff could not be loaded: ${staffError.message}`,
    );
  }

  addIds(recipientIds, (slotStaff ?? []).map((staff) => staff.user_id));
}

async function addDirectRecipients(
  admin: AdminClient,
  recipientIds: Set<string>,
  channelId: string,
) {
  const { data, error } = await admin
    .from("chat_direct_participants")
    .select("user_id")
    .eq("channel_id", channelId);

  if (error) {
    throw new Error(
      `Chat email direct-message participants could not be loaded: ${error.message}`,
    );
  }

  addIds(recipientIds, (data ?? []).map((participant) => participant.user_id));
}

async function loadChannelRecipientIds(
  admin: AdminClient,
  channel: ChatChannel,
) {
  const recipientIds = new Set<string>();

  if (["direct_message", "group_direct_message"].includes(channel.channel_type)) {
    await addDirectRecipients(admin, recipientIds, channel.id);
    return [...recipientIds];
  }

  await addActiveRoleRecipients(admin, recipientIds, ["owner"]);

  if (channel.channel_type === "applicant_community") {
    await addActiveRoleRecipients(admin, recipientIds, ["applicant"]);
  }

  if (channel.channel_type === "general") {
    await addActiveRoleRecipients(admin, recipientIds, [
      "adjudicator",
      "advisory_member",
      "program_manager",
    ]);
  }

  if (channel.channel_type === "networking") {
    await addActiveRoleRecipients(admin, recipientIds, [
      "adjudicator",
      "advisory_member",
    ]);
  }

  if (channel.channel_type === "advisory_committee") {
    await addActiveRoleRecipients(admin, recipientIds, ["advisory_member"]);
  }

  if (channel.channel_type === "scholarship_dm") {
    await addActiveRoleRecipients(admin, recipientIds, ["program_manager"]);
  }

  if (["school_dm", "scholarship_dm"].includes(channel.channel_type)) {
    await addApplicationApplicantRecipients(
      admin,
      recipientIds,
      channel.application_id,
    );
  }

  if (channel.channel_type === "school") {
    await addPanelRecipients(admin, recipientIds, channel.application_id);
  }

  return [...recipientIds];
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
    { data: channel, error: channelError },
    { data: author, error: authorError },
  ] = await Promise.all([
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

  if (channelError || !channel) {
    const detail = channelError?.message ?? "Chat channel not found.";
    await logDelivery("failed", 0, detail);
    throw new Error(`Chat email channel could not be loaded: ${detail}`);
  }

  if (authorError) {
    await logDelivery("failed", 0, authorError.message);
    throw new Error(`Chat email author could not be loaded: ${authorError.message}`);
  }

  const safeChannel = channel as ChatChannel;
  let recipientIds: string[];
  try {
    recipientIds = (await loadChannelRecipientIds(admin, safeChannel)).filter(
      (id) => id !== authorId,
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Recipient lookup failed.";
    await logDelivery("failed", 0, detail);
    throw error;
  }

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

  const label = channelLabel(safeChannel);
  const application = channelApplication(safeChannel);
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
