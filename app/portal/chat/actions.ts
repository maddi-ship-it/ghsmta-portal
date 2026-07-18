"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type ChatActionResult = {
  ok: boolean;
  error?: string;
};

function formText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
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

  const supabase = await createClient();
  const { error } = await supabase.from("chat_posts").insert({
    channel_id: channelId,
    author_id: profile.id,
    subject,
    body,
  });

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  revalidatePath("/portal/chat");
  return { ok: true };
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

  const supabase = await createClient();
  const { error } = await supabase.from("chat_replies").insert({
    channel_id: channelId,
    post_id: postId,
    author_id: profile.id,
    body,
  });

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  revalidatePath("/portal/chat");
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
    .select("id,pinned,locked")
    .eq("id", postId)
    .single();

  if (readError || !post) {
    return {
      ok: false,
      error: readError?.message ?? "Chat post not found.",
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
