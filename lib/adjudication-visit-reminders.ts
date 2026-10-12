import { randomUUID } from "node:crypto";

import {
  buildApplicationReferencePanels,
  type ApplicationEligibilityAppeal,
  type ApplicationReferencePanel,
} from "@/lib/application-reference-panels";
import { sendSmtpEmail } from "@/lib/email/smtp";
import {
  applicationReferencePdfFilename,
  createApplicationReferencePdf,
} from "@/lib/reports/application-reference-pdf";
import { portalSiteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Application,
  ApplicationAnswer,
  ApplicationQuestion,
} from "@/lib/types";

const EASTERN_TIME_ZONE = "America/New_York";
const REQUIRED_VIEW_KEYS = [
  "eligibility",
  "acting-candidates",
  "musical-budget",
  "program-vision",
  "full-application",
] as const;

type VisitDetails = {
  venue_name: string | null;
  venue_address: string | null;
  arrival_entrance: string | null;
  parking_instructions: string | null;
  accessibility_notes: string | null;
  wifi_network: string | null;
  wifi_password: string | null;
  day_of_contact_name: string | null;
  day_of_contact_phone: string | null;
};

type VisitSlot = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  school_instructions: string | null;
};

type ReminderAttachment = {
  filename: string;
  content: Buffer;
  contentType: "application/pdf";
};

type ReminderContext = {
  application: Application;
  slot: VisitSlot;
  details: VisitDetails | null;
  channelId: string;
  authorId: string;
  recipients: string[];
  panelNames: string[];
  attachments: ReminderAttachment[];
};

type ClaimedReminder = {
  id: string;
  slot_id: string;
  application_id: string;
  scheduled_for: string;
  delivery_kind: "scheduled" | "demo";
  email_sent_at: string | null;
  panel_posted_at: string | null;
  claim_token: string | null;
  recipient_override: string | null;
  suppress_panel_post: boolean;
  subject_prefix: string;
};

export type VisitReminderCopyInput = {
  schoolName: string;
  productionTitle: string;
  scheduleTitle: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  details: VisitDetails | null;
  panelNames: string[];
  applicationId: string;
  subjectPrefix?: string;
  schoolInstructions?: string | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))} ET`;
}

function clean(value: string | null | undefined) {
  return value?.trim() || "Not provided";
}

export function buildVisitReminderCopy(input: VisitReminderCopyInput) {
  const date = formatDate(input.startsAt);
  const time = formatTime(input.startsAt, input.endsAt);
  const detailRows = [
    ["School", input.schoolName],
    ["Production", input.productionTitle],
    ["Schedule", input.scheduleTitle],
    ["Date", date],
    ["Time", time],
    ["Venue", clean(input.details?.venue_name ?? input.location)],
    ["Address", clean(input.details?.venue_address)],
    ["Arrival entrance", clean(input.details?.arrival_entrance)],
    ["Parking", clean(input.details?.parking_instructions)],
    ["Accessibility", clean(input.details?.accessibility_notes)],
    ["Wi-Fi network", clean(input.details?.wifi_network)],
    ["Wi-Fi access", clean(input.details?.wifi_password)],
    ["Day-of contact", clean(input.details?.day_of_contact_name)],
    ["Day-of phone", clean(input.details?.day_of_contact_phone)],
    ["School instructions", clean(input.schoolInstructions)],
  ] as Array<[string, string]>;

  const portalUrl = `${portalSiteUrl()}/portal/adjudication/${input.applicationId}`;
  const subject = `${input.subjectPrefix ?? ""}72-HOUR ADJUDICATION VISIT REMINDER — ${input.schoolName}`;
  const panel = input.panelNames.length
    ? input.panelNames.join(", ")
    : "Assigned panel members";
  const textRows = detailRows.map(([label, value]) => `${label}: ${value}`);
  const text = [
    "Your adjudication visit is 72 hours away.",
    "",
    ...textRows,
    `Assigned panel: ${panel}`,
    "",
    "The five attached PDFs contain the current Eligibility, Acting Candidates, Budget, Program Maturity/Vision/Support, and Full Application views.",
    `Open the adjudication workspace: ${portalUrl}`,
  ].join("\n");
  const htmlRows = detailRows
    .map(
      ([label, value]) =>
        `<tr><th align="left" style="padding:7px 12px 7px 0;vertical-align:top;color:#172033">${escapeHtml(label)}</th><td style="padding:7px 0;color:#4c566a;white-space:pre-line">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#172033;max-width:760px">
      <p style="font-size:12px;font-weight:700;letter-spacing:.12em;color:#9b7207;margin:0 0 8px">ADJUDICATION VISIT</p>
      <h1 style="font-size:26px;margin:0 0 8px">72-hour visit reminder</h1>
      <p style="font-size:16px;color:#4c566a;margin:0 0 22px">Your adjudication visit is 72 hours away.</p>
      <table style="border-collapse:collapse;width:100%;border-top:1px solid #d7dce5;border-bottom:1px solid #d7dce5">${htmlRows}</table>
      <p><strong>Assigned panel:</strong> ${escapeHtml(panel)}</p>
      <p>The five attached PDFs contain the current Eligibility, Acting Candidates, Budget, Program Maturity/Vision/Support, and Full Application views.</p>
      <p><a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:12px 18px;background:#153f8f;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Open adjudication workspace</a></p>
    </div>`;
  const chatBody = [
    "Your adjudication visit is 72 hours away.",
    "",
    ...textRows.map((row) => `**${row.split(":")[0]}:**${row.slice(row.indexOf(":") + 1)}`),
    `**Assigned panel:** ${panel}`,
    "",
    "The current adjudication views are attached as five PDFs.",
    `Open adjudication workspace: ${portalUrl}`,
  ].join("\n");

  return { subject, text, html, chatBody };
}

async function loadReminderContext(slotId: string, applicationId: string) {
  const admin = createAdminClient();
  const [applicationResult, slotResult, detailsResult, staffResult, channelResult, ownerResult] =
    await Promise.all([
      admin.from("applications").select("*").eq("id", applicationId).single(),
      admin
        .from("schedule_slots")
        .select("id,title,starts_at,ends_at,location,school_instructions")
        .eq("id", slotId)
        .single(),
      admin.from("schedule_slot_school_details").select("venue_name,venue_address,arrival_entrance,parking_instructions,accessibility_notes,wifi_network,wifi_password,day_of_contact_name,day_of_contact_phone").eq("slot_id", slotId).maybeSingle(),
      admin.from("schedule_slot_staff").select("user_id").eq("slot_id", slotId),
      admin.from("chat_channels").select("id").eq("application_id", applicationId).eq("channel_type", "school").eq("active", true).limit(1).maybeSingle(),
      admin.from("profiles").select("id").eq("role", "owner").eq("active", true).order("created_at").limit(1).maybeSingle(),
    ]);

  const loadError =
    applicationResult.error ??
    slotResult.error ??
    detailsResult.error ??
    staffResult.error ??
    channelResult.error ??
    ownerResult.error;
  if (loadError) throw new Error(loadError.message);
  if (!applicationResult.data || !slotResult.data) {
    throw new Error("The scheduled application could not be loaded.");
  }
  if (!channelResult.data?.id) throw new Error("Panel channel not found.");
  if (!ownerResult.data?.id) throw new Error("An active Owner profile is required.");

  const application = applicationResult.data as Application;
  const userIds = [...new Set((staffResult.data ?? []).map((staff) => staff.user_id))];
  const profilesResult = userIds.length
    ? await admin
        .from("profiles")
        .select("id,email,full_name,active")
        .in("id", userIds)
        .eq("active", true)
    : { data: [], error: null };
  if (profilesResult.error) throw new Error(profilesResult.error.message);

  const [questionsResult, answersResult, formResult, appealsResult] = await Promise.all([
    application.form_version_id
      ? admin.from("application_questions").select("*").eq("form_version_id", application.form_version_id).order("sort_order")
      : Promise.resolve({ data: [], error: null }),
    admin.from("application_answers").select("*").eq("application_id", applicationId),
    application.form_version_id
      ? admin.from("application_form_versions").select("scoring_rubric_id").eq("id", application.form_version_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from("appeals").select("category_id,current_eligibility,requested_eligibility,status,submitted_at").eq("application_id", applicationId).eq("appeal_type", "eligibility").order("submitted_at", { ascending: false }),
  ]);
  const applicationDataError =
    questionsResult.error ?? answersResult.error ?? formResult.error ?? appealsResult.error;
  if (applicationDataError) throw new Error(applicationDataError.message);

  const rubricId = formResult.data?.scoring_rubric_id;
  const categoriesResult = rubricId
    ? await admin.from("scoring_categories").select("id,category_key,title").eq("rubric_id", rubricId).eq("active", true).order("sort_order")
    : { data: [], error: null };
  if (categoriesResult.error) throw new Error(categoriesResult.error.message);

  const panels = buildApplicationReferencePanels({
    application,
    questions: (questionsResult.data ?? []) as ApplicationQuestion[],
    answers: (answersResult.data ?? []) as ApplicationAnswer[],
    eligibilityCategories: categoriesResult.data ?? [],
    eligibilityAppeals: (appealsResult.data ?? []) as ApplicationEligibilityAppeal[],
  });
  const panelsByKey = new Map(panels.map((panel) => [panel.key, panel]));
  const orderedPanels = REQUIRED_VIEW_KEYS.map((key) => panelsByKey.get(key)).filter(
    (panel): panel is ApplicationReferencePanel => Boolean(panel),
  );
  if (orderedPanels.length !== REQUIRED_VIEW_KEYS.length) {
    throw new Error("All five adjudication views could not be generated.");
  }

  const attachmentLabels: Record<(typeof REQUIRED_VIEW_KEYS)[number], string> = {
    eligibility: "01-eligibility",
    "acting-candidates": "02-acting-candidates",
    "musical-budget": "03-budget",
    "program-vision": "04-program-maturity-vision-support",
    "full-application": "05-full-application",
  };
  const attachments = await Promise.all(
    orderedPanels.map(async (panel) => ({
      filename: `${attachmentLabels[panel.key as keyof typeof attachmentLabels] ?? applicationReferencePdfFilename(panel).replace(/\.pdf$/, "")}.pdf`,
      content: Buffer.from(
        await createApplicationReferencePdf(panel, {
          schoolName: application.school_name,
          productionTitle: application.production_title ?? "Untitled production",
        }),
      ),
      contentType: "application/pdf" as const,
    })),
  );
  const profiles = profilesResult.data ?? [];

  return {
    application,
    slot: slotResult.data as VisitSlot,
    details: detailsResult.data as VisitDetails | null,
    channelId: channelResult.data.id,
    authorId: ownerResult.data.id,
    recipients: profiles
      .map((profile) => profile.email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email)),
    panelNames: profiles
      .map((profile) => profile.full_name?.trim() || profile.email?.trim())
      .filter((name): name is string => Boolean(name)),
    attachments,
  } satisfies ReminderContext;
}

function reminderCopy(context: ReminderContext, subjectPrefix = "") {
  return buildVisitReminderCopy({
    schoolName: context.application.school_name,
    productionTitle: context.application.production_title ?? "Untitled production",
    scheduleTitle: context.slot.title,
    startsAt: context.slot.starts_at,
    endsAt: context.slot.ends_at,
    location: context.slot.location,
    details: context.details,
    panelNames: context.panelNames,
    applicationId: context.application.id,
    subjectPrefix,
    schoolInstructions: context.slot.school_instructions,
  });
}

async function postReminderToPanel(context: ReminderContext, subjectPrefix = "") {
  const admin = createAdminClient();
  const copy = reminderCopy(context, subjectPrefix);
  const postResult = await admin
    .from("chat_posts")
    .insert({
      channel_id: context.channelId,
      author_id: context.authorId,
      subject: copy.subject,
      body: copy.chatBody,
    })
    .select("id")
    .single();
  if (postResult.error || !postResult.data) {
    throw new Error(postResult.error?.message ?? "Panel reminder could not be posted.");
  }

  const storagePaths: string[] = [];
  try {
    for (const attachment of context.attachments) {
      const storagePath = `system/${context.channelId}/${context.slot.id}/${randomUUID()}-${attachment.filename}`;
      const uploadResult = await admin.storage
        .from("chat-files")
        .upload(storagePath, attachment.content, {
          cacheControl: "3600",
          contentType: attachment.contentType,
          upsert: false,
        });
      if (uploadResult.error) throw new Error(uploadResult.error.message);
      storagePaths.push(storagePath);
      const metadataResult = await admin.from("chat_attachments").insert({
        channel_id: context.channelId,
        message_kind: "post",
        message_id: postResult.data.id,
        original_name: attachment.filename,
        storage_path: storagePath,
        mime_type: attachment.contentType,
        file_size: attachment.content.byteLength,
        uploaded_by: context.authorId,
      });
      if (metadataResult.error) throw new Error(metadataResult.error.message);
    }
    return postResult.data.id as string;
  } catch (error) {
    await admin.from("chat_attachments").delete().eq("message_id", postResult.data.id);
    if (storagePaths.length) await admin.storage.from("chat-files").remove(storagePaths);
    await admin.from("chat_posts").delete().eq("id", postResult.data.id);
    throw error;
  }
}

async function emailReminder(
  context: ReminderContext,
  recipients = context.recipients,
  subjectPrefix = "",
) {
  if (!recipients.length) throw new Error("The assigned panel has no active email recipients.");
  const copy = reminderCopy(context, subjectPrefix);
  const result = await sendSmtpEmail({
    to: recipients,
    subject: copy.subject,
    text: copy.text,
    html: copy.html,
    attachments: context.attachments,
  });
  if (!result.ok) throw new Error(result.detail);
  return result;
}

export async function sendAdjudicationVisitReminderDemo({
  slotId,
  applicationId,
  recipient,
}: {
  slotId: string;
  applicationId: string;
  recipient: string;
}) {
  const context = await loadReminderContext(slotId, applicationId);
  const email = await emailReminder(context, [recipient], "DEMO — ");
  return {
    email,
    schoolName: context.application.school_name,
    attachmentCount: context.attachments.length,
  };
}

export async function processAdjudicationVisitReminders() {
  const admin = createAdminClient();
  const claimToken = randomUUID();
  const claimResult = await admin.rpc("claim_due_adjudication_visit_reminders", {
    p_claim_token: claimToken,
    p_limit: 25,
  });
  if (claimResult.error) throw new Error(claimResult.error.message);
  const claims = (claimResult.data ?? []) as ClaimedReminder[];
  let sent = 0;
  let partial = 0;
  let failed = 0;

  for (const claim of claims) {
    const errors: string[] = [];
    let panelPostedAt = claim.panel_posted_at;
    let emailSentAt = claim.email_sent_at;
    let panelPostId: string | null = null;
    let recipientCount = 0;
    let attachmentCount = 0;
    try {
      const context = await loadReminderContext(claim.slot_id, claim.application_id);
      recipientCount = claim.recipient_override ? 1 : context.recipients.length;
      attachmentCount = context.attachments.length;

      if (!panelPostedAt && !claim.suppress_panel_post) {
        try {
          panelPostId = await postReminderToPanel(context, claim.subject_prefix);
          panelPostedAt = new Date().toISOString();
          await admin
            .from("adjudication_visit_reminder_deliveries")
            .update({ panel_posted_at: panelPostedAt, panel_post_id: panelPostId })
            .eq("id", claim.id)
            .eq("claim_token", claimToken);
        } catch (error) {
          errors.push(`Panel channel: ${error instanceof Error ? error.message : "delivery failed"}`);
        }
      }

      if (!emailSentAt) {
        try {
          await emailReminder(
            context,
            claim.recipient_override
              ? [claim.recipient_override.trim().toLowerCase()]
              : context.recipients,
            claim.subject_prefix,
          );
          emailSentAt = new Date().toISOString();
          await admin
            .from("adjudication_visit_reminder_deliveries")
            .update({ email_sent_at: emailSentAt })
            .eq("id", claim.id)
            .eq("claim_token", claimToken);
        } catch (error) {
          errors.push(`Email: ${error instanceof Error ? error.message : "delivery failed"}`);
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Reminder preparation failed");
    }

    const panelComplete = claim.suppress_panel_post || Boolean(panelPostedAt);
    const status = panelComplete && emailSentAt ? "sent" : panelPostedAt || emailSentAt ? "partial" : "failed";
    const completionResult = await admin
      .from("adjudication_visit_reminder_deliveries")
      .update({
        status,
        recipient_count: recipientCount,
        attachment_count: attachmentCount,
        claim_token: null,
        claimed_at: null,
        next_attempt_at:
          status === "sent"
            ? new Date("9999-12-31T23:59:59.000Z").toISOString()
            : new Date(Date.now() + 15 * 60_000).toISOString(),
        last_error: errors.length ? errors.join("; ").slice(0, 2000) : null,
      })
      .eq("id", claim.id)
      .eq("claim_token", claimToken);
    if (completionResult.error) throw new Error(completionResult.error.message);
    if (status === "sent") sent += 1;
    else if (status === "partial") partial += 1;
    else failed += 1;
  }

  return { claimed: claims.length, sent, partial, failed };
}
