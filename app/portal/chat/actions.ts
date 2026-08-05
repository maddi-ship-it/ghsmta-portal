"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { sendChatEmailNotifications } from "@/lib/chat/email-notifications";
import { SCHOOL_COMMUNITY_CHAT_LABEL } from "@/lib/chat-terminology";
import { createClient } from "@/lib/supabase/server";

type ChatActionResult = {
  ok: boolean;
  error?: string;
  count?: number;
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
    | "advisory_committee";
};

function formText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function profileDisplayName(profile: { full_name?: string | null; email?: string | null }) {
  return profile.full_name?.trim() || profile.email || "Someone";
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

  const { supabase, channel, error: channelError } =
    await readChannelMode(channelId);

  if (channelError || !channel) {
    return { ok: false, error: channelError ?? "Chat channel not found." };
  }

  if (channel.channel_type !== "applicant_community") {
    return {
      ok: false,
      error: `Replies are only available in ${SCHOOL_COMMUNITY_CHAT_LABEL}.`,
    };
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
