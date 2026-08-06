import { NextResponse } from "next/server";

import { requireProfile } from "@/lib/auth";
import { buildReportCsv, buildReportPdf, reportFilename } from "@/lib/reports/report-export";
import { loadReport, parseReportFilters } from "@/lib/reports/report-data";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function logReportRun({
  supabase,
  report,
  ownerId,
  filename,
  byteSize,
  mimeType,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  report: Awaited<ReturnType<typeof loadReport>>;
  ownerId: string;
  filename: string;
  byteSize: number;
  mimeType: string;
}) {
  try {
    await supabase.from("report_runs").insert({
      report_key: report.definition.id,
      report_title: report.definition.title,
      requested_format: report.filters.format,
      variant: report.filters.variant,
      status: "completed",
      requested_by: ownerId,
      filters: report.filters,
      row_count: report.rows.length,
      file_name: filename,
      mime_type: mimeType,
      byte_size: byteSize,
      generated_at: report.generatedAt,
    });
  } catch {
    // The report center migration may not have reached an environment yet.
    // Downloads should continue to work even if audit persistence is pending.
  }

  try {
    await supabase.from("owner_activity_log").insert({
      activity_type: "report_generated",
      title: `Generated ${report.definition.title}`,
      detail: `${report.rows.length} row(s) exported as ${report.filters.format.toUpperCase()}.`,
      actor_id: ownerId,
      metadata: {
        report_key: report.definition.id,
        format: report.filters.format,
        row_count: report.rows.length,
        warnings: report.warnings,
      },
    });
  } catch {
    // Best-effort audit.
  }
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{ report: string }>;
  },
) {
  const owner = await requireProfile(["owner"]);
  const { report: reportId } = await context.params;
  const url = new URL(request.url);
  const filters = parseReportFilters(url.searchParams);
  const supabase = await createClient();

  try {
    const report = await loadReport(supabase, reportId, filters);

    if (report.filters.format === "csv") {
      const csv = buildReportCsv(report);
      const body = Buffer.from(csv, "utf8");
      const filename = reportFilename(report, "csv");
      await logReportRun({
        supabase,
        report,
        ownerId: owner.id,
        filename,
        byteSize: body.byteLength,
        mimeType: "text/csv; charset=utf-8",
      });
      return new NextResponse(body, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(body.byteLength),
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
    }

    const pdfBytes = await buildReportPdf(report);
    const body = Buffer.from(pdfBytes);
    const filename = reportFilename(report, "pdf");
    await logReportRun({
      supabase,
      report,
      ownerId: owner.id,
      filename,
      byteSize: body.byteLength,
      mimeType: "application/pdf",
    });

    return new NextResponse(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(body.byteLength),
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The report could not be generated.",
      },
      { status: error instanceof Error && error.message === "Unknown report." ? 404 : 500 },
    );
  }
}
