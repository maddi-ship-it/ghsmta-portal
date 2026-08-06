"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { sendChatEmailNotifications } from "@/lib/chat/email-notifications";
import { normalizePhoneE164 } from "@/lib/phone";
import { sendSmtpEmail } from "@/lib/email/smtp";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

const USER_PATH = "/portal/admin/users";

function selectedIds(formData: FormData) {
  return [...new Set(formData.getAll("user_ids").map(String).filter(Boolean))];
}

function revalidateUsers() {
  revalidatePath(USER_PATH);
  revalidatePath("/portal/admin/scoring");
  revalidatePath("/portal/admin/setup");
  revalidatePath("/portal/chat");
}

function selectedText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function messageSubject(formData: FormData) {
  return selectedText(formData, "message_subject").slice(0, 160) || "Message from GHSMTA";
}

function messageBody(formData: FormData) {
  return selectedText(formData, "message_body").slice(0, 5000);
}

async function loadSelectedRecipients(userIds: string[]) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id,email,full_name,role,active")
    .in("id", userIds)
    .eq("active", true);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: string;
    email: string | null;
    full_name: string | null;
    role: AppRole;
    active: boolean;
  }>;
}

async function findExistingDirectChannel(ownerId: string, recipientId: string) {
  const admin = createAdminClient();
  const { data: participantRows, error } = await admin
    .from("chat_direct_participants")
    .select("channel_id,user_id")
    .in("user_id", [ownerId, recipientId]);
  if (error) throw new Error(error.message);

  const counts = new Map<string, Set<string>>();
  for (const row of participantRows ?? []) {
    const set = counts.get(row.channel_id) ?? new Set<string>();
    set.add(row.user_id);
    counts.set(row.channel_id, set);
  }

  const candidateIds = [...counts.entries()]
    .filter(([, ids]) => ids.has(ownerId) && ids.has(recipientId))
    .map(([channelId]) => channelId);
  if (candidateIds.length === 0) return null;

  const { data: channels, error: channelError } = await admin
    .from("chat_channels")
    .select("id")
    .in("id", candidateIds)
    .eq("channel_type", "direct_message")
    .eq("active", true)
    .limit(1);
  if (channelError) throw new Error(channelError.message);
  return channels?.[0]?.id ?? null;
}

async function createOwnerMessageChannel({
  owner,
  recipients,
  subject,
  body,
  mode,
}: {
  owner: { id: string; full_name: string | null; email: string | null };
  recipients: Array<{ id: string; full_name: string | null; email: string | null }>;
  subject: string;
  body: string;
  mode: "group" | "individual";
}) {
  const admin = createAdminClient();
  const recipientNames = recipients.map((recipient) => recipient.full_name ?? recipient.email ?? "User");
  let channelId =
    mode === "individual" && recipients[0]
      ? await findExistingDirectChannel(owner.id, recipients[0].id)
      : null;

  if (!channelId) {
    const { data: channel, error: channelError } = await admin
      .from("chat_channels")
      .insert({
        channel_type: mode === "group" ? "group_direct_message" : "direct_message",
        name:
          mode === "group"
            ? `Group chat: ${recipientNames.slice(0, 3).join(", ")}${recipientNames.length > 3 ? ` +${recipientNames.length - 3}` : ""}`
            : `Chat: ${recipientNames[0] ?? "User"}`,
        description:
          mode === "group"
            ? "Owner-created group chat from the Users page."
            : "Owner-created direct chat from the Users page.",
        active: true,
        created_by: owner.id,
      })
      .select("id")
      .single();
    if (channelError || !channel) {
      throw new Error(channelError?.message ?? "The chat channel could not be created.");
    }
    channelId = channel.id;
  }

  const participantIds = [
    owner.id,
    ...recipients.map((recipient) => recipient.id),
  ];
  const { error: participantError } = await admin
    .from("chat_direct_participants")
    .upsert(
      participantIds.map((userId) => ({
        channel_id: channelId,
        user_id: userId,
        added_by: owner.id,
      })),
      { onConflict: "channel_id,user_id" },
    );
  if (participantError) throw new Error(participantError.message);

  const { data: post, error: postError } = await admin
    .from("chat_posts")
    .insert({
      channel_id: channelId,
      author_id: owner.id,
      subject,
      body,
    })
    .select("id")
    .single();
  if (postError || !post) {
    throw new Error(postError?.message ?? "The chat message could not be posted.");
  }

  const { error: notificationError } = await admin
    .from("user_notifications")
    .insert(
      recipients.map((recipient) => ({
        user_id: recipient.id,
        notification_type: "chat_message",
        title: subject,
        body: body.slice(0, 500),
        href: `/portal/chat?channel=${channelId}`,
      })),
    );
  if (notificationError) throw new Error(notificationError.message);

  try {
    await sendChatEmailNotifications({
      channelId,
      messageId: post.id,
      messageKind: "post",
      authorId: owner.id,
      authorName: owner.full_name ?? owner.email ?? "GHSMTA Owner",
      subject,
      body,
    });
  } catch (error) {
    await admin.from("owner_activity_log").insert({
      activity_type: "bulk_user_message_email_failed",
      title: "Bulk user chat email failed",
      detail: error instanceof Error ? error.message : "Email delivery failed.",
      actor_id: owner.id,
      metadata: {
        channel_id: channelId,
        recipient_count: recipients.length,
      },
    });
  }

  await admin.from("owner_activity_log").insert({
    activity_type: "bulk_user_message_sent",
    title: mode === "group" ? "Owner sent group chat" : "Owner sent direct chat",
    detail: `${subject} · ${recipients.length} recipient(s).`,
    actor_id: owner.id,
    metadata: {
      channel_id: channelId,
      recipient_ids: recipients.map((recipient) => recipient.id),
      mode,
    },
  });

  return channelId;
}

async function bulkMessageUsers({
  owner,
  userIds,
  formData,
  mode,
}: {
  owner: { id: string; full_name: string | null; email: string | null };
  userIds: string[];
  formData: FormData;
  mode: "group" | "individual";
}) {
  const subject = messageSubject(formData);
  const body = messageBody(formData);
  if (!body) throw new Error("Enter a message before sending.");

  const recipients = (await loadSelectedRecipients(userIds)).filter(
    (recipient) => recipient.id !== owner.id,
  );
  if (recipients.length === 0) {
    throw new Error("Choose at least one active user other than yourself.");
  }
  if (mode === "group") {
    await createOwnerMessageChannel({ owner, recipients, subject, body, mode });
  } else {
    for (const recipient of recipients) {
      await createOwnerMessageChannel({
        owner,
        recipients: [recipient],
        subject,
        body,
        mode,
      });
    }
  }
  revalidateUsers();
  redirect(
    `${USER_PATH}?message_sent=${recipients.length}&message_mode=${mode}`,
  );
}

export async function updateUserAccess(userId: string, formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const role = String(formData.get("role") ?? "applicant") as AppRole;
  const active = formData.get("active") === "on";
  const phoneInput = String(formData.get("phone_e164") ?? "").trim();
  const phone = phoneInput ? normalizePhoneE164(phoneInput) : null;
  const mfaRequired = formData.get("mfa_required") === "on";
  if (phoneInput && !phone) throw new Error("Enter a valid mobile number.");

  if (owner.id === userId && (role !== "owner" || !active)) {
    throw new Error("Owners cannot remove or deactivate their own owner access.");
  }

  const supabase = await createClient();
  const { data: existing } = await supabase.from("profiles").select("phone_e164").eq("id", userId).single();
  const phoneChanged = (existing?.phone_e164 ?? null) !== phone;
  const { error } = await supabase.from("profiles").update({
    role,
    active,
    phone_e164: phone,
    phone_verified_at: phoneChanged ? null : undefined,
    phone_required_at: phoneChanged && phone ? new Date().toISOString() : undefined,
    mfa_required:
      role === "owner" ||
      role === "advisory_member" ||
      role === "program_manager"
        ? true
        : mfaRequired,
  }).eq("id", userId);
  if (error) throw new Error(error.message);
  revalidateUsers();
}

export async function bulkUpdateUsers(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const userIds = selectedIds(formData);
  const operation = String(formData.get("bulk_operation") ?? "");

  if (userIds.length === 0) throw new Error("Select at least one user.");

  if (operation === "message_group" || operation === "message_individual") {
    await bulkMessageUsers({
      owner,
      userIds,
      formData,
      mode: operation === "message_group" ? "group" : "individual",
    });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (operation === "role") {
    const role = String(formData.get("bulk_role") ?? "applicant") as AppRole;
    updates.role = role;
    if (["advisory_member", "program_manager", "owner"].includes(role)) {
      updates.mfa_required = true;
      updates.mfa_grace_until = new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000,
      ).toISOString();
    }
  } else if (operation === "activate") {
    updates.active = true;
  } else if (operation === "deactivate") {
    updates.active = false;
  } else {
    throw new Error("Choose a valid bulk user action.");
  }

  if (userIds.includes(owner.id) && (updates.role !== undefined && updates.role !== "owner" || updates.active === false)) {
    throw new Error("Your own Owner account cannot be demoted or deactivated.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(updates).in("id", userIds);
  if (error) throw new Error(error.message);
  revalidateUsers();
  redirect(`${USER_PATH}?updated=${userIds.length}`);
}

export async function forcePasswordReset(userId: string) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name")
    .eq("id", userId)
    .single();

  if (profileError || !profile?.email) {
    throw new Error(profileError?.message ?? "This user does not have an email address.");
  }

  const headerStore = await headers();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? headerStore.get("origin") ?? "http://localhost:3000";
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: profile.email,
    options: { redirectTo: `${siteUrl}/auth/callback?next=/update-password` },
  });

  if (error) throw new Error(error.message);

  const result = await sendSmtpEmail({
    to: [profile.email],
    subject: "Reset your GHSMTA Portal password",
    text: `An Owner has required a password reset for your GHSMTA Portal account. Open this secure link: ${data.properties.action_link}`,
    html: `<h2>GHSMTA Portal password reset</h2><p>An Owner has required a password reset for your account.</p><p><a href="${data.properties.action_link}">Choose a new password</a></p><p>This link is intended only for ${profile.full_name ?? profile.email}.</p>`,
  });

  if (!result.ok) throw new Error(result.detail);

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      force_password_reset: true,
      password_reset_requested_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (updateError) throw new Error(updateError.message);
  revalidateUsers();
  redirect(`${USER_PATH}?reset_sent=1`);
}
