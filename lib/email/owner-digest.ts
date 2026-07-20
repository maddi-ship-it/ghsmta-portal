"server-only";

import { sendSmtpEmail } from "@/lib/email/smtp";
import { createClient } from "@/lib/supabase/server";

type OwnerProfile = {
  id: string;
  email: string | null;
  full_name?: string | null;
};

type DigestActivity = {
  title: string;
  detail: string | null;
  created_at: string;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderTemplate(
  template: string,
  variables: Record<string, string>,
) {
  return Object.entries(variables).reduce(
    (output, [key, value]) =>
      output.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function formatEasternDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function formatEasternDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function metricCard(label: string, value: number) {
  return `
    <td width="25%" style="padding:6px;vertical-align:top;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="border-collapse:separate;border-spacing:0;background:#111c33;border:1px solid #263756;border-radius:12px;">
        <tr>
          <td style="padding:14px 12px 5px;color:#aebbd0;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
            ${escapeHtml(label)}
          </td>
        </tr>
        <tr>
          <td style="padding:0 12px 14px;color:#f6e4aa;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;">
            ${value}
          </td>
        </tr>
      </table>
    </td>
  `;
}

function buildDigestHtml({
  ownerName,
  intro,
  reportUrl,
  activities,
  missingComments,
  missingScores,
  pendingBookings,
  waitlistEntries,
}: {
  ownerName: string;
  intro: string;
  reportUrl: string;
  activities: DigestActivity[];
  missingComments: number;
  missingScores: number;
  pendingBookings: number;
  waitlistEntries: number;
}) {
  const activityMarkup =
    activities.length > 0
      ? activities
          .map(
            (activity) => `
              <tr>
                <td style="padding:0 0 12px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                    style="border-collapse:separate;border-spacing:0;background:#111c33;border:1px solid #263756;border-radius:12px;">
                    <tr>
                      <td style="padding:14px 16px 5px;color:#f5f1e8;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:1.4;">
                        ${escapeHtml(activity.title)}
                      </td>
                    </tr>
                    ${
                      activity.detail
                        ? `<tr>
                            <td style="padding:0 16px 7px;color:#c4cede;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;">
                              ${escapeHtml(activity.detail)}
                            </td>
                          </tr>`
                        : ""
                    }
                    <tr>
                      <td style="padding:0 16px 14px;color:#8290a8;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;">
                        ${escapeHtml(
                          formatEasternDateTime(activity.created_at),
                        )} ET
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            `,
          )
          .join("")
      : `
          <tr>
            <td style="padding:18px;color:#c4cede;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;background:#111c33;border:1px solid #263756;border-radius:12px;">
              No Owner activity was recorded during the last 24 hours.
            </td>
          </tr>
        `;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>GHSMTA Owner daily review</title>
  </head>
  <body style="margin:0;padding:0;background:#070b17;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="width:100%;border-collapse:collapse;background:#070b17;">
      <tr>
        <td align="center" style="padding:28px 14px;">
          <table role="presentation" width="680" cellpadding="0" cellspacing="0"
            style="width:100%;max-width:680px;border-collapse:separate;border-spacing:0;background:#0b1325;border:1px solid #223352;border-radius:20px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.35);">
            <tr>
              <td style="height:7px;background:#d4af37;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:26px 30px 24px;background:#001699;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="color:#f6e4aa;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">
                      GHSMTA Awards Portal
                    </td>
                  </tr>
                  <tr>
                    <td style="padding-top:7px;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:31px;font-weight:700;line-height:1.15;">
                      Owner daily review
                    </td>
                  </tr>
                  <tr>
                    <td style="padding-top:8px;color:#dce5ff;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;">
                      A polished 24-hour summary for ${escapeHtml(ownerName)}.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 24px 8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    ${metricCard("Comments missing", missingComments)}
                    ${metricCard("Scores missing", missingScores)}
                    ${metricCard("Pending slots", pendingBookings)}
                    ${metricCard("Waitlist", waitlistEntries)}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 30px 6px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                  style="border-collapse:separate;border-spacing:0;background:#101a30;border-left:4px solid #d4af37;border-radius:10px;">
                  <tr>
                    <td style="padding:15px 17px;color:#dce4f1;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;">
                      ${escapeHtml(intro).replaceAll("\n", "<br>")}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 30px 10px;color:#f6e4aa;font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:700;">
                Activity from the last 24 hours
              </td>
            </tr>
            <tr>
              <td style="padding:0 30px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${activityMarkup}
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 30px 30px;">
                <a href="${escapeHtml(reportUrl)}"
                  style="display:inline-block;padding:13px 22px;border-radius:10px;background:#d4af37;color:#07101d;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;text-decoration:none;">
                  Open Owner Reports
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 30px;border-top:1px solid #223352;color:#8290a8;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.55;">
                This internal GHSMTA report may contain confidential application
                and adjudication information. Generated by the GHSMTA Awards Portal.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildDigestText({
  intro,
  activities,
  missingComments,
  missingScores,
  pendingBookings,
  waitlistEntries,
  reportUrl,
}: {
  intro: string;
  activities: DigestActivity[];
  missingComments: number;
  missingScores: number;
  pendingBookings: number;
  waitlistEntries: number;
  reportUrl: string;
}) {
  const lines = [
    "GHSMTA OWNER DAILY REVIEW",
    "",
    intro,
    "",
    `Comments missing: ${missingComments}`,
    `Scores missing: ${missingScores}`,
    `Pending timeslot approvals: ${pendingBookings}`,
    `Active waitlist entries: ${waitlistEntries}`,
    "",
    "ACTIVITY FROM THE LAST 24 HOURS",
    "",
    ...(activities.length
      ? activities.flatMap((activity) => [
          activity.title,
          activity.detail ?? "",
          `${formatEasternDateTime(activity.created_at)} ET`,
          "",
        ])
      : ["No Owner activity was recorded during the last 24 hours.", ""]),
    `Open Owner Reports: ${reportUrl}`,
  ];

  return lines.filter((line, index) => line || lines[index - 1] !== "").join("\n");
}

export async function sendOwnerDigestEmail(owner: OwnerProfile) {
  const supabase = await createClient();
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [
    settingResult,
    activitiesResult,
    templateResult,
    commentsResult,
    scoresResult,
    bookingsResult,
    waitlistResult,
  ] = await Promise.all([
    supabase
      .from("owner_digest_settings")
      .select(
        "enabled,recipient_email,delivery_hour,time_zone,last_sent_at",
      )
      .eq("owner_user_id", owner.id)
      .maybeSingle(),
    supabase
      .from("owner_activity_log")
      .select("title,detail,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("portal_message_templates")
      .select("subject_template,body_template,active")
      .eq("template_key", "daily_digest")
      .maybeSingle(),
    supabase
      .from("owner_report_missing_comments")
      .select("application_id", { count: "exact", head: true }),
    supabase
      .from("owner_report_missing_scores")
      .select("application_id", { count: "exact", head: true }),
    supabase
      .from("schedule_school_bookings")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "pending"),
    supabase
      .from("schedule_slot_waitlist")
      .select("id", { count: "exact", head: true })
      .in("status", ["waiting", "offered"]),
  ]);

  for (const result of [
    settingResult,
    activitiesResult,
    templateResult,
    commentsResult,
    scoresResult,
    bookingsResult,
    waitlistResult,
  ]) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  const recipient =
    settingResult.data?.recipient_email?.trim() || owner.email?.trim();

  if (!recipient) {
    throw new Error(
      "Add a recipient email to Daily Digest settings first.",
    );
  }

  const digestDate = formatEasternDate(now);
  const variables = {
    digest_date: digestDate,
    owner_name: owner.full_name?.trim() || "GHSMTA Owner",
  };

  const subject = renderTemplate(
    templateResult.data?.subject_template ||
      "GHSMTA Owner daily review - {{digest_date}}",
    variables,
  );

  const intro = renderTemplate(
    templateResult.data?.body_template ||
      "Your GHSMTA Owner daily review is ready.",
    variables,
  );

  const baseUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://ghsmta-portal.vercel.app"
  ).replace(/\/+$/, "");
  const reportUrl = `${baseUrl}/portal/admin/reports`;

  const activities = (activitiesResult.data ?? []) as DigestActivity[];
  const missingComments = commentsResult.count ?? 0;
  const missingScores = scoresResult.count ?? 0;
  const pendingBookings = bookingsResult.count ?? 0;
  const waitlistEntries = waitlistResult.count ?? 0;

  const result = await sendSmtpEmail({
    to: [recipient],
    subject,
    text: buildDigestText({
      intro,
      activities,
      missingComments,
      missingScores,
      pendingBookings,
      waitlistEntries,
      reportUrl,
    }),
    html: buildDigestHtml({
      ownerName: variables.owner_name,
      intro,
      reportUrl,
      activities,
      missingComments,
      missingScores,
      pendingBookings,
      waitlistEntries,
    }),
  });

  if (!result.ok) {
    throw new Error(result.detail);
  }

  const sentAt = now.toISOString();
  const updateResult = await supabase
    .from("owner_digest_settings")
    .update({ last_sent_at: sentAt })
    .eq("owner_user_id", owner.id);

  if (updateResult.error) {
    throw new Error(
      `The email was sent, but the sent timestamp could not be saved: ${updateResult.error.message}`,
    );
  }

  await supabase.from("owner_activity_log").insert({
    activity_type: "digest_sent_manually",
    title: "Owner daily digest sent manually",
    detail: `Sent the branded HTML digest to ${recipient}.`,
    actor_id: owner.id,
  });

  return {
    recipient,
    sentAt,
    activityCount: activities.length,
  };
}
