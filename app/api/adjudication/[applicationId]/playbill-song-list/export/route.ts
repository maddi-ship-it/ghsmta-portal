import { NextResponse } from "next/server";

import { resolveAdjudicationObserverAccess } from "@/lib/adjudication-observer";
import {
  createPlaybillSongListDocx,
  createPlaybillSongListPdf,
} from "@/lib/playbill-song-list-export";
import {
  parsePlaybillSongList,
  PLAYBILL_SONG_LIST_EXTRACTOR_VERSION,
} from "@/lib/playbill-song-list";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADJUDICATION_ROLES = new Set(["adjudicator", "advisory_member", "owner"]);

function safeFileStem(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "playbill-song-list"
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  const { applicationId } = await context.params;
  const format = new URL(request.url).searchParams.get("format");
  if (!UUID_PATTERN.test(applicationId)) {
    return NextResponse.json({ error: "Invalid application." }, { status: 400 });
  }
  if (format !== "docx" && format !== "pdf") {
    return NextResponse.json(
      { error: "Choose a Word or PDF export." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,active")
    .eq("id", user.id)
    .maybeSingle();
  if (
    profileError ||
    !profile?.active ||
    !ADJUDICATION_ROLES.has(profile.role)
  ) {
    return NextResponse.json(
      { error: "You do not have access to this adjudication session." },
      { status: 403 },
    );
  }

  const admin = createAdminClient();
  const { data: visibleApplication, error: visibleApplicationError } =
    await supabase
      .from("applications")
      .select("id")
      .eq("id", applicationId)
      .maybeSingle();
  if (visibleApplicationError) {
    return NextResponse.json(
      { error: "The adjudication session could not be checked." },
      { status: 500 },
    );
  }

  let hasAccess = profile.role === "owner" || Boolean(visibleApplication);
  if (!hasAccess) {
    hasAccess = (
      await resolveAdjudicationObserverAccess({
        admin,
        applicationId,
        userId: user.id,
      })
    ).allowed;
  }
  if (!hasAccess) {
    return NextResponse.json(
      { error: "You do not have access to this adjudication session." },
      { status: 403 },
    );
  }

  const [applicationResult, fileResult] = await Promise.all([
    admin
      .from("applications")
      .select("school_name,production_title")
      .eq("id", applicationId)
      .maybeSingle(),
    admin
      .from("portal_files")
      .select("id,display_name,generated_name,original_name")
      .eq("application_id", applicationId)
      .eq("context_type", "application")
      .eq("document_category", "playbill")
      .eq("reviewer_visible", true)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (applicationResult.error || fileResult.error) {
    return NextResponse.json(
      { error: "The song-list export is temporarily unavailable." },
      { status: 500 },
    );
  }
  if (!applicationResult.data || !fileResult.data) {
    return NextResponse.json(
      { error: "No Playbill song list is available for this show." },
      { status: 404 },
    );
  }

  const { data: cache, error: cacheError } = await admin
    .from("playbill_song_lists")
    .select("songs")
    .eq("portal_file_id", fileResult.data.id)
    .eq("extractor_version", PLAYBILL_SONG_LIST_EXTRACTOR_VERSION)
    .maybeSingle();
  if (cacheError) {
    return NextResponse.json(
      { error: "The song-list export is temporarily unavailable." },
      { status: 500 },
    );
  }
  const songs = parsePlaybillSongList(cache ?? {});
  if (!songs?.length) {
    return NextResponse.json(
      { error: "No Playbill song list is available for this show." },
      { status: 404 },
    );
  }

  const sourceFileName =
    fileResult.data.display_name?.trim() ||
    fileResult.data.generated_name.trim() ||
    fileResult.data.original_name.trim() ||
    "Uploaded Playbill";
  const exportInput = {
    productionTitle:
      applicationResult.data.production_title?.trim() || "Untitled production",
    schoolName: applicationResult.data.school_name,
    sourceFileName,
    songs,
  };
  const bytes =
    format === "pdf"
      ? await createPlaybillSongListPdf(exportInput)
      : createPlaybillSongListDocx(exportInput);
  const fileName = `${safeFileStem(exportInput.productionTitle)}-song-list.${format}`;

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type":
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  });
}
