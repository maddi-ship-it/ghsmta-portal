import "server-only";

import {
  chatChannelLabel,
  loadChatChannelRecipientIds,
  type ChatNotificationChannel,
} from "@/lib/chat/email-notifications";
import {
  buildUrgentChatSms,
  canUseUrgentTag,
  containsUrgentMention,
} from "@/lib/chat/urgent";
import { portalSiteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";

type UrgentSmsStatus =
  | "not_urgent"
  | "queued"
  | "no_recipients"
  | "not_configured"
  | "not_authorized"
  | "partial_failure"
  | "failed";

export type UrgentSmsResult = {
  triggered: boolean;
  status: UrgentSmsStatus;
  recipientCount: number;
  queuedCount: number;
};

type TwilioConfig = {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string | null;
  fromNumber: string | null;
};

type TwilioMessageResponse = {
  sid?: string;
  status?: string;
  code?: number;
};

function loadTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid =
    process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null;
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim() || null;

  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
    return null;
  }

  return {
    accountSid,
    authToken,
    messagingServiceSid,
    fromNumber,
  };
}

function isE164Phone(value: string | null | undefined): value is string {
  return Boolean(value && /^\+[1-9]\d{7,14}$/.test(value));
}

async function sendTwilioSms({
  config,
  to,
  body,
}: {
  config: TwilioConfig;
  to: string;
  body: string;
}) {
  const form = new URLSearchParams({ To: to, Body: body });

  if (config.messagingServiceSid) {
    form.set("MessagingServiceSid", config.messagingServiceSid);
  } else if (config.fromNumber) {
    form.set("From", config.fromNumber);
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      cache: "no-store",
    },
  );
  const payload = (await response.json().catch(() => ({}))) as TwilioMessageResponse;

  if (!response.ok || !payload.sid) {
    const providerCode = payload.code ? ` (${payload.code})` : "";
    throw new Error(`Twilio rejected the message${providerCode}.`);
  }

  return {
    sid: payload.sid,
    status: payload.status ?? "accepted",
  };
}

export async function sendUrgentChatSmsNotifications({
  channelId,
  messageId,
  messageKind,
  authorId,
  authorRole,
  authorName,
  subject,
  body,
}: {
  channelId: string;
  messageId: string;
  messageKind: "post" | "reply";
  authorId: string;
  authorRole: string;
  authorName: string;
  subject: string;
  body: string;
}): Promise<UrgentSmsResult> {
  const messageText = subject === "Message" ? body : `${subject}\n${body}`;
  if (!containsUrgentMention(messageText)) {
    return {
      triggered: false,
      status: "not_urgent",
      recipientCount: 0,
      queuedCount: 0,
    };
  }

  if (!canUseUrgentTag(authorRole)) {
    console.warn("Blocked unauthorized @URGENT chat alert", {
      authorId,
      channelId,
      messageId,
      messageKind,
    });
    return {
      triggered: true,
      status: "not_authorized",
      recipientCount: 0,
      queuedCount: 0,
    };
  }

  const config = loadTwilioConfig();
  if (!config) {
    return {
      triggered: true,
      status: "not_configured",
      recipientCount: 0,
      queuedCount: 0,
    };
  }

  const admin = createAdminClient();
  const { data: channel, error: channelError } = await admin
    .from("chat_channels")
    .select(
      "id,channel_type,name,application_id,applications(school_name,production_title,external_applicant_email)",
    )
    .eq("id", channelId)
    .maybeSingle();

  if (channelError || !channel) {
    throw new Error(
      `Urgent text channel could not be loaded: ${channelError?.message ?? "Chat channel not found."}`,
    );
  }

  const safeChannel = channel as ChatNotificationChannel;
  const recipientIds = (
    await loadChatChannelRecipientIds(admin, safeChannel, {
      includePortalUpdatesAudience: true,
    })
  ).filter((id) => id !== authorId);
  const { data: profiles, error: profileError } = recipientIds.length
    ? await admin
        .from("profiles")
        .select("id,phone_e164,phone_verified_at")
        .in("id", recipientIds)
        .eq("active", true)
        .not("phone_verified_at", "is", null)
    : { data: [], error: null };

  if (profileError) {
    throw new Error(
      `Urgent text recipients could not be loaded: ${profileError.message}`,
    );
  }

  const recipients = (profiles ?? []).filter((profile) =>
    isE164Phone(profile.phone_e164),
  );
  if (recipients.length === 0) {
    return {
      triggered: true,
      status: "no_recipients",
      recipientCount: 0,
      queuedCount: 0,
    };
  }

  const chatUrl = `${portalSiteUrl()}/portal/chat?channel=${channelId}`;
  const smsBody = buildUrgentChatSms({
    authorName,
    channelLabel: chatChannelLabel(safeChannel),
    message: messageText,
    chatUrl,
  });

  const results = await Promise.all(
    recipients.map(async (recipient) => {
      const { data: claimed, error: claimError } = await admin
        .from("chat_urgent_sms_deliveries")
        .upsert(
          {
            channel_id: channelId,
            message_id: messageId,
            message_kind: messageKind,
            author_id: authorId,
            recipient_user_id: recipient.id,
            status: "pending",
          },
          {
            onConflict: "message_kind,message_id,recipient_user_id",
            ignoreDuplicates: true,
          },
        )
        .select("id")
        .maybeSingle();

      if (claimError) {
        return { queued: false, failed: true };
      }
      if (!claimed) {
        return { queued: false, failed: false };
      }

      try {
        const twilio = await sendTwilioSms({
          config,
          to: recipient.phone_e164 as string,
          body: smsBody,
        });
        await admin
          .from("chat_urgent_sms_deliveries")
          .update({
            status: "accepted",
            provider_message_id: twilio.sid,
            provider_status: twilio.status,
            accepted_at: new Date().toISOString(),
            error_detail: null,
          })
          .eq("id", claimed.id);
        return { queued: true, failed: false };
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "Twilio delivery failed.";
        await admin
          .from("chat_urgent_sms_deliveries")
          .update({
            status: "failed",
            error_detail: detail.slice(0, 500),
          })
          .eq("id", claimed.id);
        return { queued: false, failed: true };
      }
    }),
  );

  const queuedCount = results.filter((result) => result.queued).length;
  const failureCount = results.filter((result) => result.failed).length;
  const status: UrgentSmsStatus =
    queuedCount === 0 && failureCount > 0
      ? "failed"
      : failureCount > 0
        ? "partial_failure"
        : "queued";

  return {
    triggered: true,
    status,
    recipientCount: recipients.length,
    queuedCount,
  };
}
