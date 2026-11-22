import { randomUUID } from "node:crypto";

import { portalSiteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";

type NotificationKind =
  | "visit_details_14_day"
  | "guest_ticket_7_day"
  | "guest_ticket_72_hour";

type ClaimedNotification = {
  id: string;
  slot_id: string;
  application_id: string;
  notification_kind: NotificationKind;
  claim_token: string;
};

type NotificationCopyInput = {
  kind: NotificationKind;
  schoolName: string;
  productionTitle: string;
  panelTicketCount: number;
  guestTicketCount: number;
  responseCount: number;
  visitDetailsUrl: string;
  guestTicketUrl: string;
};

export function buildAdjudicationScheduleNotificationCopy(
  input: NotificationCopyInput,
) {
  if (input.kind === "visit_details_14_day") {
    return {
      subject: "Complete adjudication visit details",
      body: [
        `Your adjudication visit for **${input.productionTitle}** is two weeks away.`,
        "",
        "Please finish the location, arrival, parking, and day-of contact details so the assigned panel has the information it needs.",
        `Complete visit details: ${input.visitDetailsUrl}`,
      ].join("\n"),
    };
  }

  if (input.kind === "guest_ticket_7_day") {
    return {
      subject: "Guest ticket requests due",
      body: [
        `The adjudication visit for **${input.schoolName} — ${input.productionTitle}** is one week away.`,
        "",
        `Panel responses received: **${input.responseCount} of ${input.panelTicketCount}**.`,
        "Please submit whether you need one guest ticket.",
        `Guest ticket request: ${input.guestTicketUrl}`,
      ].join("\n"),
    };
  }

  const totalTicketCount = input.panelTicketCount + input.guestTicketCount;
  return {
    subject: "72-hour panel ticket total",
    body: [
      `Ticket count for **${input.schoolName} — ${input.productionTitle}**:`,
      "",
      `- Panel tickets: **${input.panelTicketCount}**`,
      `- Guest tickets: **${input.guestTicketCount}**`,
      `- Total tickets: **${totalTicketCount}**`,
      "",
      `Guest ticket responses received: ${input.responseCount} of ${input.panelTicketCount}.`,
    ].join("\n"),
  };
}

function visitDetailsComplete(
  details: Record<string, string | null> | null,
) {
  const requiredFields = [
    "venue_name",
    "venue_address",
    "arrival_entrance",
    "parking_instructions",
    "day_of_contact_name",
    "day_of_contact_phone",
  ];
  return requiredFields.every((field) => details?.[field]?.trim());
}

async function deliverClaim(notification: ClaimedNotification) {
  const admin = createAdminClient();
  const [applicationResult, slotResult, ownerResult, staffResult, detailsResult] =
    await Promise.all([
      admin
        .from("applications")
        .select("id,school_name,production_title")
        .eq("id", notification.application_id)
        .single(),
      admin
        .from("schedule_slots")
        .select("id,starts_at")
        .eq("id", notification.slot_id)
        .single(),
      admin
        .from("profiles")
        .select("id")
        .eq("role", "owner")
        .eq("active", true)
        .order("created_at")
        .limit(1)
        .maybeSingle(),
      admin
        .from("schedule_slot_staff")
        .select("user_id")
        .eq("slot_id", notification.slot_id)
        .eq("participation_mode", "panel"),
      admin
        .from("schedule_slot_school_details")
        .select(
          "venue_name,venue_address,arrival_entrance,parking_instructions,day_of_contact_name,day_of_contact_phone",
        )
        .eq("slot_id", notification.slot_id)
        .maybeSingle(),
    ]);

  const loadError =
    applicationResult.error ??
    slotResult.error ??
    ownerResult.error ??
    staffResult.error ??
    detailsResult.error;
  if (loadError) throw new Error(loadError.message);
  if (!applicationResult.data || !slotResult.data || !ownerResult.data) {
    throw new Error("The scheduled adjudication notification is incomplete.");
  }

  if (
    notification.notification_kind === "visit_details_14_day" &&
    visitDetailsComplete(detailsResult.data)
  ) {
    const { error } = await admin
      .from("adjudication_schedule_notification_deliveries")
      .update({
        status: "skipped",
        claim_token: null,
        claimed_at: null,
        last_error: "Visit details were completed before delivery.",
      })
      .eq("id", notification.id)
      .eq("claim_token", notification.claim_token);
    if (error) throw new Error(error.message);
    return "skipped" as const;
  }

  const candidatePanelUserIds = [
    ...new Set((staffResult.data ?? []).map((row) => row.user_id)),
  ];
  const activeProfilesResult = candidatePanelUserIds.length
    ? await admin
        .from("profiles")
        .select("id")
        .in("id", candidatePanelUserIds)
        .eq("active", true)
    : { data: [], error: null };
  if (activeProfilesResult.error) {
    throw new Error(activeProfilesResult.error.message);
  }
  const panelUserIds = (activeProfilesResult.data ?? []).map(
    (profile) => profile.id,
  );
  const ticketRequestsResult = panelUserIds.length
    ? await admin
        .from("adjudication_guest_ticket_requests")
        .select("user_id,needs_guest_ticket")
        .eq("slot_id", notification.slot_id)
        .in("user_id", panelUserIds)
    : { data: [], error: null };
  if (ticketRequestsResult.error) {
    throw new Error(ticketRequestsResult.error.message);
  }

  const channelType =
    notification.notification_kind === "visit_details_14_day"
      ? "school_dm"
      : "school";
  const channelResult = await admin
    .from("chat_channels")
    .select("id")
    .eq("application_id", notification.application_id)
    .eq("channel_type", channelType)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (channelResult.error) throw new Error(channelResult.error.message);
  if (!channelResult.data?.id) {
    throw new Error(
      channelType === "school_dm"
        ? "The applicant-facing school channel was not found."
        : "The assigned panel channel was not found.",
    );
  }

  const requests = ticketRequestsResult.data ?? [];
  const copy = buildAdjudicationScheduleNotificationCopy({
    kind: notification.notification_kind,
    schoolName: applicationResult.data.school_name,
    productionTitle:
      applicationResult.data.production_title ?? "Untitled production",
    panelTicketCount: panelUserIds.length,
    guestTicketCount: requests.filter((request) => request.needs_guest_ticket)
      .length,
    responseCount: requests.length,
    visitDetailsUrl: `${portalSiteUrl()}/portal/schedule#school-visit-details`,
    guestTicketUrl: `${portalSiteUrl()}/portal/guest-ticket-request`,
  });

  const { data: post, error: postError } = await admin
    .from("chat_posts")
    .insert({
      channel_id: channelResult.data.id,
      author_id: ownerResult.data.id,
      subject: copy.subject,
      body: copy.body,
    })
    .select("id")
    .single();
  if (postError || !post) {
    throw new Error(postError?.message ?? "The channel message was not saved.");
  }

  const { error: completionError } = await admin
    .from("adjudication_schedule_notification_deliveries")
    .update({
      status: "sent",
      post_id: post.id,
      claim_token: null,
      claimed_at: null,
      last_error: null,
    })
    .eq("id", notification.id)
    .eq("claim_token", notification.claim_token);
  if (completionError) throw new Error(completionError.message);
  return "sent" as const;
}

export async function processAdjudicationScheduleNotifications() {
  const admin = createAdminClient();
  const claimToken = randomUUID();
  const { data, error } = await admin.rpc(
    "claim_due_adjudication_schedule_notifications",
    { p_claim_token: claimToken, p_limit: 50 },
  );
  if (error) throw new Error(error.message);

  let sent = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const row of (data ?? []) as ClaimedNotification[]) {
    try {
      const outcome = await deliverClaim(row);
      if (outcome === "sent") sent += 1;
      else skipped += 1;
    } catch (deliveryError) {
      const detail =
        deliveryError instanceof Error
          ? deliveryError.message
          : "Notification delivery failed.";
      const { error: releaseError } = await admin
        .from("adjudication_schedule_notification_deliveries")
        .update({
          status: "failed",
          claim_token: null,
          claimed_at: null,
          next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          last_error: detail.slice(0, 1000),
        })
        .eq("id", row.id)
        .eq("claim_token", claimToken);
      failures.push(
        `${row.id}: ${detail}${
          releaseError ? `; retry release failed: ${releaseError.message}` : ""
        }`,
      );
    }
  }

  return { sent, skipped, failures };
}
