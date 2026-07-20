import { NextResponse } from "next/server";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type ReportName =
  | "missing-comments"
  | "missing-scores"
  | "specialty-awards";

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    return "No records\n";
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((row) =>
      headers.map((header) => csvCell(row[header])).join(","),
    ),
  ];

  return `\uFEFF${lines.join("\n")}\n`;
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ report: string }>;
  },
) {
  await requireProfile(["owner"]);
  const { report } = await context.params;

  const selected = report as ReportName;
  const config = {
    "missing-comments": {
      view: "owner_report_missing_comments",
      filename: "ghsmta-comments-missing.csv",
    },
    "missing-scores": {
      view: "owner_report_missing_scores",
      filename: "ghsmta-scores-missing.csv",
    },
    "specialty-awards": {
      view: "owner_report_specialty_awards",
      filename: "ghsmta-specialty-award-recommendations.csv",
    },
  }[selected];

  if (!config) {
    return NextResponse.json(
      { error: "Unknown report." },
      { status: 404 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(config.view)
    .select("*")
    .limit(10000);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return new Response(
    toCsv((data ?? []) as Record<string, unknown>[]),
    {
      headers: {
        "Content-Disposition": `attachment; filename="${config.filename}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
