import { NextResponse } from "next/server";

import { requireProfile } from "@/lib/auth";
import { buildReleasedResultsPdf } from "@/lib/reports/released-results-pdf";
import { createClient } from "@/lib/supabase/server";
import type {
  AdjudicationRelease,
  Application,
  AwardCycle,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFilename(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || "school";
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ applicationId: string }>;
  },
) {
  await requireProfile(["applicant"]);
  const { applicationId } = await context.params;
  const supabase = await createClient();

  const { data: applicationData, error: applicationError } = await supabase
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .eq("is_archived", false)
    .maybeSingle();

  if (applicationError) {
    return NextResponse.json(
      { error: applicationError.message },
      { status: 500 },
    );
  }

  if (!applicationData) {
    return NextResponse.json(
      { error: "Application not found or unavailable." },
      { status: 404 },
    );
  }

  const application = applicationData as Application;
  const [releaseResult, cycleResult] = await Promise.all([
    supabase
      .from("adjudication_releases")
      .select("*")
      .eq("application_id", application.id)
      .maybeSingle(),
    supabase
      .from("award_cycles")
      .select("*")
      .eq("id", application.cycle_id)
      .maybeSingle(),
  ]);

  if (releaseResult.error) {
    return NextResponse.json(
      { error: releaseResult.error.message },
      { status: 500 },
    );
  }

  if (!releaseResult.data) {
    return NextResponse.json(
      { error: "No released results are available for this application." },
      { status: 404 },
    );
  }

  if (cycleResult.error) {
    return NextResponse.json(
      { error: cycleResult.error.message },
      { status: 500 },
    );
  }

  const release = releaseResult.data as AdjudicationRelease;
  const cycle = (cycleResult.data as AwardCycle | null) ?? null;
  const pdfBytes = await buildReleasedResultsPdf({
    application,
    cycle,
    release,
  });
  const filename = `ghsmta-released-results-${safeFilename(
    application.school_name,
  )}.pdf`;

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdfBytes.byteLength),
      "Content-Type": "application/pdf",
    },
  });
}
