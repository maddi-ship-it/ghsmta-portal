"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { sendOwnerDigestEmail } from "@/lib/email/owner-digest";
import { findReportDefinition, type ReportFormat, type ReportVariant } from "@/lib/reports/report-definitions";
import { createClient } from "@/lib/supabase/server";

function finish(
  report: string,
  kind: "success" | "error",
  message: string,
): never {
  const params = new URLSearchParams({
    report,
    [kind]: message,
  });
  redirect(`/portal/admin/reports?${params.toString()}`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function filtersFromFormData(formData: FormData) {
  return {
    cycle_id: text(formData, "cycle_id"),
    date_from: text(formData, "date_from"),
    date_to: text(formData, "date_to"),
    school: text(formData, "school"),
    status: text(formData, "status"),
    include_archived: formData.get("include_archived") === "on",
    include_internal_notes: formData.get("include_internal_notes") === "on",
    include_contact_info: formData.get("include_contact_info") === "on",
    include_adjudicator_identities:
      formData.get("include_adjudicator_identities") === "on",
    include_protected_scores: formData.get("include_protected_scores") === "on",
    sort: text(formData, "sort"),
    direction: text(formData, "direction") || "asc",
  };
}

function reportRedirect(report: string, kind: "success" | "error", message: string): never {
  const params = new URLSearchParams({
    report,
    [kind]: message,
  });
  redirect(`/portal/admin/reports?${params.toString()}`);
}

function nextDailyRunAt(hour: number, timeZone: string) {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const candidate = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2, "0")}:00:00`,
  );
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.toISOString();
}

export async function sendOwnerDigestFromReports(
  formData: FormData,
) {
  const owner = await requireProfile(["owner"]);
  const report = String(
    formData.get("report") ?? "missing-comments",
  );

  try {
    const result = await sendOwnerDigestEmail(owner);
    finish(
      report,
      "success",
      `Daily digest sent to ${result.recipient}.`,
    );
  } catch (caught) {
    finish(
      report,
      "error",
      caught instanceof Error
        ? caught.message
        : "The daily digest could not be sent.",
    );
  }
}

export async function saveReportPreset(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const reportKey = text(formData, "report_key");
  const definition = findReportDefinition(reportKey);
  if (!definition) throw new Error("Choose a valid report.");
  const name = text(formData, "preset_name");
  if (!name) throw new Error("Name the preset before saving.");
  const format = (text(formData, "format") || definition.formats[0] || "pdf") as ReportFormat;
  const variant = (text(formData, "variant") || "internal") as ReportVariant;
  const supabase = await createClient();
  const { error } = await supabase.from("report_presets").insert({
    owner_user_id: owner.id,
    report_key: reportKey,
    name,
    description: text(formData, "preset_description") || null,
    filters: filtersFromFormData(formData),
    columns: [],
    format,
    variant,
    favorite: formData.get("favorite") === "on",
  });
  if (error) reportRedirect(reportKey, "error", error.message);
  revalidatePath("/portal/admin/reports");
  reportRedirect(reportKey, "success", "Report preset saved.");
}

export async function saveReportSchedule(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const reportKey = text(formData, "report_key");
  const definition = findReportDefinition(reportKey);
  if (!definition) throw new Error("Choose a valid report.");
  const name = text(formData, "schedule_name");
  if (!name) throw new Error("Name the schedule before saving.");
  const deliveryEmails = text(formData, "delivery_emails")
    .split(/[,\n;]/)
    .map((email) => email.trim())
    .filter(Boolean);
  if (deliveryEmails.length === 0) {
    throw new Error("Add at least one delivery email.");
  }
  const deliveryHour = Number(text(formData, "delivery_hour"));
  if (!Number.isInteger(deliveryHour) || deliveryHour < 0 || deliveryHour > 23) {
    throw new Error("Choose a delivery hour between 0 and 23.");
  }
  const timeZone = text(formData, "time_zone") || "America/New_York";
  const format = (text(formData, "format") || definition.formats[0] || "pdf") as ReportFormat;
  const variant = (text(formData, "variant") || "internal") as ReportVariant;
  const supabase = await createClient();
  const { error } = await supabase.from("report_schedules").insert({
    owner_user_id: owner.id,
    report_key: reportKey,
    name,
    enabled: true,
    format,
    variant,
    filters: filtersFromFormData(formData),
    delivery_emails: deliveryEmails,
    cron_expression: `daily@${deliveryHour}`,
    time_zone: timeZone,
    next_run_at: nextDailyRunAt(deliveryHour, timeZone),
  });
  if (error) reportRedirect(reportKey, "error", error.message);
  revalidatePath("/portal/admin/reports");
  reportRedirect(reportKey, "success", "Report schedule saved.");
}

export async function deleteReportPreset(presetId: string) {
  const owner = await requireProfile(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("report_presets")
    .delete()
    .eq("id", presetId)
    .eq("owner_user_id", owner.id);
  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/reports");
}

export async function toggleReportSchedule(scheduleId: string, enabled: boolean) {
  const owner = await requireProfile(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("report_schedules")
    .update({ enabled })
    .eq("id", scheduleId)
    .eq("owner_user_id", owner.id);
  if (error) throw new Error(error.message);
  revalidatePath("/portal/admin/reports");
}
