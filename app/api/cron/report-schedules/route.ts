import { buildReportCsv, buildReportPdf, reportFilename } from "@/lib/reports/report-export";
import { loadReport, parseReportFilters } from "@/lib/reports/report-data";
import { sendSmtpEmail } from "@/lib/email/smtp";
import { logEvent } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReportScheduleRow = {
  id: string;
  owner_user_id: string;
  report_key: string;
  name: string;
  format: "pdf" | "csv" | "zip";
  variant: "internal" | "external";
  filters: Record<string, unknown> | null;
  delivery_emails: string[];
  next_run_at: string | null;
  time_zone: string;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function nextDailyFrom(value: string | null) {
  const next = value ? new Date(value) : new Date();
  next.setDate(next.getDate() + 1);
  return next.toISOString();
}

function filtersToSearchParams(schedule: ReportScheduleRow) {
  const searchParams = new URLSearchParams();
  const filters = schedule.filters ?? {};
  Object.entries(filters).forEach(([key, value]) => {
    if (value == null || value === "" || value === false) return;
    searchParams.set(key, value === true ? "on" : String(value));
  });
  searchParams.set("format", schedule.format === "csv" ? "csv" : "pdf");
  searchParams.set("variant", schedule.variant);
  return searchParams;
}

async function processReportSchedules() {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { data: schedules, error } = await supabase
    .from("report_schedules")
    .select("id,owner_user_id,report_key,name,format,variant,filters,delivery_emails,next_run_at,time_zone")
    .eq("enabled", true)
    .lte("next_run_at", now)
    .limit(20);

  if (error) throw new Error(error.message);

  let sent = 0;
  const failures: string[] = [];

  for (const schedule of (schedules ?? []) as ReportScheduleRow[]) {
    let reportRunId: string | null = null;
    try {
      const report = await loadReport(
        supabase,
        schedule.report_key,
        parseReportFilters(filtersToSearchParams(schedule)),
      );
      const isCsv = report.filters.format === "csv";
      const filename = reportFilename(report, isCsv ? "csv" : "pdf");
      const content = isCsv
        ? Buffer.from(buildReportCsv(report), "utf8")
        : Buffer.from(await buildReportPdf(report));
      const contentType = isCsv ? "text/csv; charset=utf-8" : "application/pdf";

      const { data: run } = await supabase
        .from("report_runs")
        .insert({
          report_key: report.definition.id,
          report_title: report.definition.title,
          requested_format: report.filters.format,
          variant: report.filters.variant,
          status: "completed",
          requested_by: schedule.owner_user_id,
          filters: report.filters,
          row_count: report.rows.length,
          file_name: filename,
          mime_type: contentType,
          byte_size: content.byteLength,
          generated_at: report.generatedAt,
        })
        .select("id")
        .maybeSingle();
      reportRunId = run?.id ?? null;

      const emailResult = await sendSmtpEmail({
        to: schedule.delivery_emails,
        subject: `GHSMTA scheduled report — ${report.definition.title}`,
        text: `Your scheduled GHSMTA report "${report.definition.title}" is attached.\n\nRows: ${report.rows.length}\nWarnings: ${report.warnings.join("; ") || "None"}`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">
            <h2>Scheduled GHSMTA report</h2>
            <p>Your scheduled report <strong>${escapeHtml(report.definition.title)}</strong> is attached.</p>
            <p><strong>Rows:</strong> ${report.rows.length}</p>
            ${report.warnings.length ? `<p><strong>Data notes:</strong> ${escapeHtml(report.warnings.join("; "))}</p>` : ""}
          </div>
        `,
        attachments: [{ filename, content, contentType }],
      });

      if (!emailResult.ok) throw new Error(emailResult.detail);

      await supabase.from("report_delivery_log").insert({
        report_run_id: reportRunId,
        report_schedule_id: schedule.id,
        recipient_email: schedule.delivery_emails.join(", "),
        delivery_status: "sent",
        detail: emailResult.detail,
        delivered_at: now,
      });
      await supabase
        .from("report_schedules")
        .update({
          last_run_at: now,
          last_status: "sent",
          next_run_at: nextDailyFrom(schedule.next_run_at),
        })
        .eq("id", schedule.id);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scheduled report failed.";
      failures.push(`${schedule.id}: ${message}`);
      await supabase.from("report_delivery_log").insert({
        report_run_id: reportRunId,
        report_schedule_id: schedule.id,
        recipient_email: schedule.delivery_emails.join(", "),
        delivery_status: "failed",
        detail: message.slice(0, 1000),
      });
      await supabase
        .from("report_schedules")
        .update({
          last_run_at: now,
          last_status: "failed",
          next_run_at: nextDailyFrom(schedule.next_run_at),
        })
        .eq("id", schedule.id);
    }
  }

  return { processed: schedules?.length ?? 0, sent, failures };
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processReportSchedules();
    logEvent("info", "cron.report_schedules.completed", result);
    return Response.json({ ok: true, reportSchedules: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report schedule cron failed.";
    logEvent("error", "cron.report_schedules.failed", { message });
    return Response.json({ error: message }, { status: 500 });
  }
}
