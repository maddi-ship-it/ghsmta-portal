"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { sendChatEmailNotifications } from "@/lib/chat/email-notifications";
import { SCHOOL_COMMUNITY_CHAT_LABEL } from "@/lib/chat-terminology";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type ChatActionResult = {
  ok: boolean;
  error?: string;
  count?: number;
  channelId?: string;
  messageId?: string;
  messageKind?: "post" | "reply";
};

type ChannelMode = {
  channel_type:
    | "school"
    | "school_dm"
    | "scholarship_dm"
    | "applicant_community"
    | "general"
    | "networking"
    | "scheduling"
    | "advisory_committee"
    | "portal_updates";
};

function formText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function profileDisplayName(profile: { full_name?: string | null; email?: string | null }) {
  return profile.full_name?.trim() || profile.email || "Someone";
}

export async function startChatDirectMessage(
  formData: FormData,
): Promise<ChatActionResult> {
  const profile = await requireProfile();
  const otherUserId = formText(formData, "user_id");

  if (profile.role === "applicant") {
    return {
      ok: false,
      error: "Applicant conversations must use School Messaging.",
    };
  }

  if (!isUuid(otherUserId)) {
    return { ok: false, error: "Choose a portal user to message." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "start_or_get_chat_direct_message",
    { p_other_user_id: otherUserId },
  );

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "The direct message could not be opened.",
    };
  }

  revalidatePath("/portal/chat");
  revalidatePath("/portal/notifications");
  return { ok: true, channelId: String(data) };
}

export async function createOwnerChatChannel(
  formData: FormData,
): Promise<ChatActionResult> {
  const owner = await requireProfile(["owner"]);
  const name = formText(formData, "channel_name");
  const description = formText(formData, "channel_description");
  const selectedUserIds = [
    ...new Set(
      formData
        .getAll("user_ids")
        .map(String)
        .filter((value) => isUuid(value) && value !== owner.id),
    ),
  ];

  if (!name) {
    return { ok: false, error: "Add a channel name." };
  }
  if (name.length > 120 || description.length > 500) {
    return {
      ok: false,
      error: "The channel name or description is longer than the allowed limit.",
    };
  }
  if (selectedUserIds.length === 0) {
    return { ok: false, error: "Choose at least one channel member." };
  }

  const admin = createAdminClient();
  const { data: selectedProfiles, error: profileError } = await admin
    .from("profiles")
    .select("id,role")
    .in("id", selectedUserIds)
    .eq("active", true)
    .neq("role", "applicant");

  if (profileError) return { ok: false, error: profileError.message };
  if ((selectedProfiles ?? []).length !== selectedUserIds.length) {
    return {
      ok: false,
      error: "One or more selected members are no longer available.",
    };
  }

  const { data: channel, error: channelError } = await admin
    .from("chat_channels")
    .insert({
      channel_type: "group_direct_message",
      name,
      description:
        description || "Private Owner-created portal conversation.",
      active: true,
      created_by: owner.id,
    })
    .select("id")
    .single();

  if (channelError || !channel) {
    return {
      ok: false,
      error: channelError?.message ?? "The channel could not be created.",
    };
  }

  const participantIds = [owner.id, ...selectedUserIds];
  const { error: participantError } = await admin
    .from("chat_direct_participants")
    .insert(
      participantIds.map((userId) => ({
        channel_id: channel.id,
        user_id: userId,
        added_by: owner.id,
      })),
    );

  if (participantError) {
    await admin.from("chat_channels").delete().eq("id", channel.id);
    return { ok: false, error: participantError.message };
  }

  revalidatePath("/portal/chat");
  revalidatePath("/portal/notifications");
  return { ok: true, channelId: channel.id };
}

async function readChannelMode(channelId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_channels")
    .select("channel_type")
    .eq("id", channelId)
    .single();

  if (error || !data) {
    return {
      supabase,
      channel: null,
      error: error?.message ?? "Chat channel not found.",
    };
  }

  return {
    supabase,
    channel: data as ChannelMode,
    error: null,
  };
}

export async function createChatPost(
  formData: FormData,
): Promise<ChatActionResult> {
  const profile = await requireProfile();
  const channelId = formText(formData, "channel_id");
  const subject = formText(formData, "subject");
  const body = formText(formData, "body");

  if (!channelId || !subject || !body) {
    return {
      ok: false,
      error: "Add both a subject and a message before posting.",
    };
  }

  if (subject.length > 180 || body.length > 5000) {
    return {
      ok: false,
      error: "The subject or message is longer than the allowed limit.",
    };
  }

  const { supabase, channel, error: channelError } =
    await readChannelMode(channelId);

  if (channelError || !channel) {
    return { ok: false, error: channelError ?? "Chat channel not found." };
  }

  if (channel.channel_type !== "applicant_community") {
    return {
      ok: false,
      error: `Only ${SCHOOL_COMMUNITY_CHAT_LABEL} uses threaded conversations.`,
    };
  }

  const { data: post, error } = await supabase
    .from("chat_posts")
    .insert({
      channel_id: channelId,
      author_id: profile.id,
      subject,
      body,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  try {
    await sendChatEmailNotifications({
      channelId,
      messageId: post.id,
      messageKind: "post",
      authorId: profile.id,
      authorName: profileDisplayName(profile),
      subject,
      body,
    });
  } catch (error) {
    console.warn("Chat email notification failed", error);
    // Chat should remain sent even if email notification delivery is unavailable.
  }

  revalidatePath("/portal/chat");
  return { ok: true, messageId: post.id, messageKind: "post" };
}

export async function createChatReply(
  formData: FormData,
): Promise<ChatActionResult> {
  const profile = await requireProfile();
  const channelId = formText(formData, "channel_id");
  const postId = formText(formData, "post_id");
  const body = formText(formData, "body");
  const replyToMessageId = formText(formData, "reply_to_message_id");
  const replyToMessageKind = formText(formData, "reply_to_message_kind");

  if (!channelId || !postId || !body) {
    return {
      ok: false,
      error: "Enter a reply before sending.",
    };
  }

  if (body.length > 5000) {
    return {
      ok: false,
      error: "The reply is longer than the allowed limit.",
    };
  }

  if (
    (replyToMessageId && !isUuid(replyToMessageId)) ||
    (replyToMessageId && !["post", "reply"].includes(replyToMessageKind)) ||
    (!replyToMessageId && replyToMessageKind)
  ) {
    return { ok: false, error: "The message being replied to could not be found." };
  }

  const { supabase, channel, error: channelError } =
    await readChannelMode(channelId);

  if (channelError || !channel) {
    return { ok: false, error: channelError ?? "Chat channel not found." };
  }

  if (
    channel.channel_type === "portal_updates" &&
    profile.role !== "owner"
  ) {
    return {
      ok: false,
      error: "Only Owners can reply in Portal Updates.",
    };
  }

  let replyReference: {
    reply_to_post_id?: string;
    reply_to_reply_id?: string;
  } = {};

  if (replyToMessageId && replyToMessageKind === "post") {
    const { data: referencedPost, error: referenceError } = await supabase
      .from("chat_posts")
      .select("id")
      .eq("id", replyToMessageId)
      .eq("channel_id", channelId)
      .eq("id", postId)
      .maybeSingle();

    if (referenceError || !referencedPost) {
      return { ok: false, error: "The message being replied to could not be found." };
    }

    replyReference = { reply_to_post_id: replyToMessageId };
  }

  if (replyToMessageId && replyToMessageKind === "reply") {
    const { data: referencedReply, error: referenceError } = await supabase
      .from("chat_replies")
      .select("id")
      .eq("id", replyToMessageId)
      .eq("channel_id", channelId)
      .eq("post_id", postId)
      .maybeSingle();

    if (referenceError || !referencedReply) {
      return { ok: false, error: "The message being replied to could not be found." };
    }

    replyReference = { reply_to_reply_id: replyToMessageId };
  }

  const [{ data: parentPost }, { data: reply, error }] = await Promise.all([
    supabase
      .from("chat_posts")
      .select("subject")
      .eq("id", postId)
      .eq("channel_id", channelId)
      .maybeSingle(),
    supabase
      .from("chat_replies")
      .insert({
        channel_id: channelId,
        post_id: postId,
        author_id: profile.id,
        body,
        ...replyReference,
      })
      .select("id")
      .single(),
  ]);

  if (error) {
    return { ok: false, error: error.message };
  }

  try {
    await sendChatEmailNotifications({
      channelId,
      messageId: reply.id,
      messageKind: "reply",
      authorId: profile.id,
      authorName: profileDisplayName(profile),
      subject: parentPost?.subject ? `Reply: ${parentPost.subject}` : "New reply",
      body,
    });
  } catch (error) {
    console.warn("Chat email notification failed", error);
    // Chat should remain sent even if email notification delivery is unavailable.
  }

  revalidatePath("/portal/chat");
  return { ok: true, messageId: reply.id, messageKind: "reply" };
}

export async function createChatMessage(
  formData: FormData,
): Promise<ChatActionResult> {
  const profile = await requireProfile();
  const channelId = formText(formData, "channel_id");
  const body = formText(formData, "body");

  if (!channelId || !body) {
    return {
      ok: false,
      error: "Enter a message before sending.",
    };
  }

  if (body.length > 5000) {
    return {
      ok: false,
      error: "The message is longer than the allowed limit.",
    };
  }

  const { supabase, channel, error: channelError } =
    await readChannelMode(channelId);

  if (channelError || !channel) {
    return { ok: false, error: channelError ?? "Chat channel not found." };
  }

  if (channel.channel_type === "applicant_community") {
    return {
      ok: false,
      error: `Start a threaded conversation in ${SCHOOL_COMMUNITY_CHAT_LABEL} instead.`,
    };
  }

  if (
    channel.channel_type === "portal_updates" &&
    profile.role !== "owner"
  ) {
    return {
      ok: false,
      error: "Only Owners can post in Portal Updates.",
    };
  }

  const { data: post, error } = await supabase
    .from("chat_posts")
    .insert({
      channel_id: channelId,
      author_id: profile.id,
      subject: "Message",
      body,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  try {
    await sendChatEmailNotifications({
      channelId,
      messageId: post.id,
      messageKind: "post",
      authorId: profile.id,
      authorName: profileDisplayName(profile),
      subject: "Message",
      body,
    });
  } catch (error) {
    console.warn("Chat email notification failed", error);
    // Chat should remain sent even if email notification delivery is unavailable.
  }

  revalidatePath("/portal/chat");
  return { ok: true, messageId: post.id, messageKind: "post" };
}

export async function editChatMessage(
  formData: FormData,
): Promise<ChatActionResult> {
  const profile = await requireProfile();
  const messageId = formText(formData, "message_id");
  const messageKind = formText(formData, "message_kind");
  const body = formText(formData, "body");

  if (!messageId || !["post", "reply"].includes(messageKind)) {
    return { ok: false, error: "Chat message not found." };
  }
  if (!body) return { ok: false, error: "A message cannot be empty." };
  if (body.length > 5000) {
    return { ok: false, error: "The message is longer than the allowed limit." };
  }

  const table = messageKind === "post" ? "chat_posts" : "chat_replies";
  const { data, error } = await (await createClient())
    .from(table)
    .update({ body })
    .eq("id", messageId)
    .eq("author_id", profile.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "You can only edit your own active messages." };

  revalidatePath("/portal/chat");
  revalidatePath("/portal/notifications");
  return {
    ok: true,
    messageId,
    messageKind: messageKind as "post" | "reply",
  };
}

export async function markChatChannelUnread(
  formData: FormData,
): Promise<ChatActionResult> {
  const profile = await requireProfile();
  const channelId = formText(formData, "channel_id");
  if (!channelId) return { ok: false, error: "Chat channel not found." };

  const { supabase, channel, error: channelError } =
    await readChannelMode(channelId);

  if (channelError || !channel) {
    return { ok: false, error: channelError ?? "Chat channel not found." };
  }

  const { data: latestActivity, error: latestError } = await supabase
    .from("chat_posts")
    .select("created_at,last_activity_at")
    .eq("channel_id", channelId)
    .is("deleted_at", null)
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return { ok: false, error: latestError.message };
  if (!latestActivity) return { ok: false, error: "This chat has no messages to mark unread." };

  const latestTime = new Date(
    latestActivity.last_activity_at ?? latestActivity.created_at,
  ).getTime();
  const unreadAt = new Date(Math.max(0, latestTime - 1000)).toISOString();

  const { error } = await supabase.from("chat_channel_reads").upsert({
    channel_id: channelId,
    user_id: profile.id,
    last_read_at: unreadAt,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/portal/chat");
  revalidatePath("/portal/notifications");
  return { ok: true };
}

export async function moderateChatPost(
  formData: FormData,
): Promise<ChatActionResult> {
  await requireProfile(["owner"]);

  const postId = formText(formData, "post_id");
  const operation = formText(formData, "operation");

  if (!postId) {
    return { ok: false, error: "Chat post not found." };
  }

  const supabase = await createClient();
  const { data: post, error: readError } = await supabase
    .from("chat_posts")
    .select("id,pinned,locked,chat_channels!inner(channel_type)")
    .eq("id", postId)
    .single();

  if (readError || !post) {
    return {
      ok: false,
      error: readError?.message ?? "Chat post not found.",
    };
  }

  const relatedChannel = Array.isArray(post.chat_channels)
    ? post.chat_channels[0]
    : post.chat_channels;

  if (relatedChannel?.channel_type !== "applicant_community") {
    return {
      ok: false,
      error: `Thread moderation is only available in ${SCHOOL_COMMUNITY_CHAT_LABEL}.`,
    };
  }

  const updates: Record<string, boolean> = {};

  if (operation === "pin") {
    updates.pinned = !post.pinned;
  } else if (operation === "lock") {
    updates.locked = !post.locked;
  } else {
    return { ok: false, error: "Unsupported moderation action." };
  }

  const { error } = await supabase
    .from("chat_posts")
    .update(updates)
    .eq("id", postId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/portal/chat");
  return { ok: true };
}


export async function ownerDeleteChatMessage(
  formData: FormData,
): Promise<ChatActionResult> {
  await requireProfile(["owner"]);

  const messageId = formText(formData, "message_id");
  const messageKind = formText(formData, "message_kind");
  const reason = formText(formData, "reason");

  if (!messageId || !["post", "reply"].includes(messageKind)) {
    return { ok: false, error: "Chat message not found." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("owner_soft_delete_chat_message", {
    p_message_kind: messageKind,
    p_message_id: messageId,
    p_reason: reason || null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/portal/chat");
  revalidatePath("/portal/notifications");
  return { ok: true };
}

export async function broadcastToActiveSchoolDms(
  formData: FormData,
): Promise<ChatActionResult> {
  await requireProfile(["owner"]);

  const body = formText(formData, "body");

  if (!body) {
    return { ok: false, error: "Enter a message before sending." };
  }

  if (body.length > 5000) {
    return {
      ok: false,
      error: "The broadcast message is longer than the allowed limit.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "broadcast_to_active_school_dms",
    { p_body: body },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/portal/chat");
  revalidatePath("/portal/notifications");

  return { ok: true, count: Number(data ?? 0) };
}
