import { NextResponse } from "next/server";

import { requireProfile } from "@/lib/auth";
import {
  buildOwnerReportPdf,
  type OwnerReportName,
} from "@/lib/reports/owner-report-pdf";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ report: string }>;
  },
) {
  await requireProfile(["owner"]);
  const { report } = await context.params;
  const selected = report as OwnerReportName;

  const config = {
    "missing-comments": {
      view: "owner_report_missing_comments",
      filename: "ghsmta-comments-missing.pdf",
    },
    "missing-scores": {
      view: "owner_report_missing_scores",
      filename: "ghsmta-scores-missing.pdf",
    },
    "specialty-awards": {
      view: "owner_report_specialty_awards",
      filename: "ghsmta-specialty-award-recommendations.pdf",
    },
  }[selected];

  if (!config) {
    return NextResponse.json(
      { error: "Unknown report." },
      { status: 404 },
    );
  }

  const supabase = await createClient();
  let query = supabase.from(config.view).select("*").limit(10000);

  if (selected === "specialty-awards") {
    query = query
      .order("school_name")
      .order("award_type")
      .order("advisory_member_name");
  } else {
    query = query
      .order("school_name")
      .order("adjudicator_name")
      .order("category_title")
      .order("criterion_title");
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  const pdfBytes = await buildOwnerReportPdf(
    selected,
    (data ?? []) as Record<string, unknown>[],
  );

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${config.filename}"`,
      "Content-Length": String(pdfBytes.byteLength),
      "Content-Type": "application/pdf",
    },
  });
}
