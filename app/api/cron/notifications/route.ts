import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderTemplate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function formatSlotDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatSlotTime(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))} ET`;
}

async function sendEmail({ to, subject, html }: { to: string[]; subject: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_FROM_EMAIL;
  if (!apiKey || !from || to.length === 0) {
    return { ok: false, detail: "Email provider not configured." };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!response.ok) return { ok: false, detail: await response.text() };
  const data = (await response.json()) as { id?: string };
  return { ok: true, detail: data.id ?? "sent" };
}

function localParts(date: Date, timeZone: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

async function processScheduleNotifications() {
  const supabase = createAdminClient();
  const now = new Date();
  const { data: rules, error: rulesError } = await supabase
    .from("schedule_notification_rules")
    .select("*")
    .eq("active", true);
  if (rulesError) throw new Error(rulesError.message);
  if (!rules?.length) return { processed: 0 };

  const maxOffset = Math.max(...rules.map((rule) => Number(rule.offset_minutes)), 0);
  const latestStart = new Date(now.getTime() + (maxOffset + 120) * 60_000).toISOString();
  const { data: slots, error: slotError } = await supabase
    .from("schedule_slots")
    .select("id,cycle_id,title,starts_at,ends_at,location,status")
    .in("status", ["open", "closed"])
    .gte("starts_at", now.toISOString())
    .lte("starts_at", latestStart);
  if (slotError) throw new Error(slotError.message);

  const { data: owners } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "owner")
    .eq("active", true)
    .limit(1);
  const botAuthorId = owners?.[0]?.id;
  if (!botAuthorId) return { processed: 0 };

  let processed = 0;
  for (const rule of rules) {
    for (const slot of slots ?? []) {
      if (rule.cycle_id && rule.cycle_id !== slot.cycle_id) continue;
      const scheduledFor = new Date(new Date(slot.starts_at).getTime() - Number(rule.offset_minutes) * 60_000);
      if (scheduledFor.getTime() > now.getTime() || scheduledFor.getTime() < now.getTime() - 70 * 60_000) continue;

      const { data: existingRun } = await supabase
        .from("schedule_notification_runs")
        .select("id")
        .eq("rule_id", rule.id)
        .eq("slot_id", slot.id)
        .eq("scheduled_for", scheduledFor.toISOString())
        .maybeSingle();
      if (existingRun) continue;

      const { data: booking } = await supabase
        .from("schedule_school_bookings")
        .select("application_id")
        .eq("slot_id", slot.id)
        .maybeSingle();
      if (!booking?.application_id) {
        await supabase.from("schedule_notification_runs").insert({
          rule_id: rule.id,
          slot_id: slot.id,
          scheduled_for: scheduledFor.toISOString(),
          status: "skipped",
          detail: "No school booking.",
        });
        continue;
      }

      const { data: application } = await supabase
        .from("applications")
        .select("id,school_name,production_title,applicant_user_id")
        .eq("id", booking.application_id)
        .single();
      if (!application) continue;

      const values = {
        school_name: application.school_name,
        production_title: application.production_title ?? "Untitled production",
        slot_date: formatSlotDate(slot.starts_at),
        slot_time: formatSlotTime(slot.starts_at, slot.ends_at),
        location: slot.location ?? "Location to be announced",
      };
      const title = renderTemplate(rule.title_template, values);
      const message = renderTemplate(rule.message_template, values);
      let status = "sent";
      let detail = "";

      if (rule.destination === "school_dm" || rule.destination === "school_channel") {
        const channelType = rule.destination === "school_dm" ? "school_dm" : "school";
        const { data: channel } = await supabase
          .from("chat_channels")
          .select("id")
          .eq("application_id", application.id)
          .eq("channel_type", channelType)
          .eq("active", true)
          .maybeSingle();
        if (channel) {
          const { error } = await supabase.from("chat_posts").insert({
            channel_id: channel.id,
            author_id: botAuthorId,
            subject: title,
            body: message,
          });
          if (error) { status = "failed"; detail = error.message; }
        } else { status = "failed"; detail = "Channel not found."; }
      } else {
        let recipientIds: string[] = [];
        if (rule.audience === "school") {
          if (application.applicant_user_id) recipientIds = [application.applicant_user_id];
        } else {
          const { data: staff } = await supabase
            .from("schedule_slot_staff")
            .select("user_id")
            .eq("slot_id", slot.id);
          recipientIds = [...new Set((staff ?? []).map((member) => member.user_id))];
        }

        if (rule.destination === "in_app") {
          if (recipientIds.length > 0) {
            const { error } = await supabase.from("user_notifications").insert(
              recipientIds.map((userId) => ({
                user_id: userId,
                notification_type: "schedule_reminder",
                title,
                body: message,
                href: "/portal/schedule",
                related_application_id: application.id,
              })),
            );
            if (error) { status = "failed"; detail = error.message; }
          }
        } else if (rule.destination === "email") {
          const { data: profiles } = recipientIds.length
            ? await supabase.from("profiles").select("email").in("id", recipientIds)
            : { data: [] as Array<{ email: string | null }> };
          const emailResult = await sendEmail({
            to: (profiles ?? []).map((profile) => profile.email).filter((email): email is string => Boolean(email)),
            subject: title,
            html: `<p>${escapeHtml(message).replaceAll("\n", "<br>")}</p>`,
          });
          if (!emailResult.ok) { status = "failed"; detail = emailResult.detail; }
        }
      }

      await supabase.from("schedule_notification_runs").insert({
        rule_id: rule.id,
        slot_id: slot.id,
        scheduled_for: scheduledFor.toISOString(),
        status,
        detail: detail || null,
      });
      processed += 1;
    }
  }
  return { processed };
}

async function processOwnerDigests() {
  const supabase = createAdminClient();
  const now = new Date();
  const { data: settings, error } = await supabase
    .from("owner_digest_settings")
    .select("*,profiles!owner_digest_settings_owner_user_id_fkey(email,full_name)")
    .eq("enabled", true);
  if (error) throw new Error(error.message);
  let sent = 0;

  for (const setting of settings ?? []) {
    const parts = localParts(now, setting.time_zone || "America/New_York");
    if (Number(parts.hour) !== Number(setting.delivery_hour)) continue;
    const localDate = `${parts.year}-${parts.month}-${parts.day}`;
    if (setting.last_sent_at) {
      const lastParts = localParts(new Date(setting.last_sent_at), setting.time_zone || "America/New_York");
      if (`${lastParts.year}-${lastParts.month}-${lastParts.day}` === localDate) continue;
    }

    const since = setting.last_sent_at ?? new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
    const { data: activities } = await supabase
      .from("owner_activity_log")
      .select("title,detail,created_at")
      .gt("created_at", since)
      .order("created_at");
    if (!setting.include_empty && !(activities ?? []).length) {
      await supabase.from("owner_digest_settings").update({ last_sent_at: now.toISOString() }).eq("owner_user_id", setting.owner_user_id);
      continue;
    }

    const profile = Array.isArray(setting.profiles) ? setting.profiles[0] : setting.profiles;
    const recipient = setting.recipient_email || profile?.email;
    if (!recipient) continue;
    const items = (activities ?? []).map((activity) => `<li><strong>${escapeHtml(activity.title)}</strong>${activity.detail ? `<br>${escapeHtml(activity.detail)}` : ""}<br><small>${escapeHtml(new Date(activity.created_at).toLocaleString("en-US"))}</small></li>`).join("");
    const result = await sendEmail({
      to: [recipient],
      subject: `GHSMTA Owner daily review — ${localDate}`,
      html: `<h2>GHSMTA Owner daily review</h2>${items ? `<ul>${items}</ul>` : "<p>No review items were recorded.</p>"}`,
    });
    if (result.ok) {
      await supabase.from("owner_digest_settings").update({ last_sent_at: now.toISOString() }).eq("owner_user_id", setting.owner_user_id);
      sent += 1;
    }
  }
  return { sent };
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [notifications, digests] = await Promise.all([
      processScheduleNotifications(),
      processOwnerDigests(),
    ]);
    return Response.json({ ok: true, notifications, digests });
  } catch (error) {
    console.error("GHSMTA cron failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Cron failed" },
      { status: 500 },
    );
  }
}
