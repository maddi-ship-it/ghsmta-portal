import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { after, NextResponse } from "next/server";

import { extractOpenAIText } from "@/lib/adjudication";
import { resolveAdjudicationObserverAccess } from "@/lib/adjudication-observer";
import { consumeApiQuota } from "@/lib/api-quota";
import {
  OPENAI_REASONING_EFFORT,
  PLAYBILL_SONG_LIST_MODEL,
} from "@/lib/openai-model";
import {
  parseOpenAIResponseUsage,
  recordAiRequestUsage,
} from "@/lib/openai-usage";
import {
  parsePlaybillSongList,
  PLAYBILL_SONG_LIST_EXTRACTOR_VERSION,
  PLAYBILL_SONG_LIST_INSTRUCTIONS,
  PLAYBILL_SONG_LIST_REQUEST,
  resolvePlaybillInputKind,
  type PlaybillSong,
} from "@/lib/playbill-song-list";
import {
  PORTAL_PLAYBILL_SONG_LIST_MISSING_PREVIEW_PREFIX,
  PORTAL_PLAYBILL_SONG_LIST_MISSING_SUBJECT_PREFIX,
} from "@/lib/chat/portal-authored";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADJUDICATION_ROLES = new Set(["adjudicator", "advisory_member", "owner"]);
const MAX_PLAYBILL_BYTES = 50_000_000;
const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

type PlaybillFileRow = {
  id: string;
  display_name: string | null;
  file_size: number | null;
  generated_name: string;
  mime_type: string | null;
  original_name: string;
  storage_path: string;
  uploaded_by: string;
};

async function postMissingSongListNotice({
  admin,
  applicationId,
  authorId,
  file,
}: {
  admin: ReturnType<typeof createAdminClient>;
  applicationId: string;
  authorId: string;
  file: PlaybillFileRow;
}) {
  const fileName = sourceFileName(file);
  const subject = `${PORTAL_PLAYBILL_SONG_LIST_MISSING_SUBJECT_PREFIX} ${fileName}`.slice(
    0,
    180,
  );
  const [channelResult, applicationResult] = await Promise.all([
    admin
      .from("chat_channels")
      .select("id")
      .eq("application_id", applicationId)
      .eq("channel_type", "school")
      .eq("active", true)
      .limit(1)
      .maybeSingle(),
    admin
      .from("applications")
      .select("school_name,production_title")
      .eq("id", applicationId)
      .maybeSingle(),
  ]);
  if (channelResult.error || !channelResult.data) {
    console.error("Missing Playbill song-list notice channel was not found", {
      applicationId,
      message: channelResult.error?.message,
    });
    return;
  }

  const { data: existingPost, error: existingPostError } = await admin
    .from("chat_posts")
    .select("id")
    .eq("channel_id", channelResult.data.id)
    .eq("subject", subject)
    .limit(1)
    .maybeSingle();
  if (existingPostError || existingPost) return;

  const showLabel = [
    applicationResult.data?.school_name,
    applicationResult.data?.production_title,
  ]
    .filter(Boolean)
    .join(" — ");
  const { error: postError } = await admin.from("chat_posts").insert({
    channel_id: channelResult.data.id,
    author_id: authorId,
    subject,
    body: [
      `${PORTAL_PLAYBILL_SONG_LIST_MISSING_PREVIEW_PREFIX}${fileName}.`,
      showLabel ? `Show: ${showLabel}` : "",
      "Please verify that the uploaded Playbill contains a printed musical-number or song-list page. Upload a corrected Playbill if needed.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  if (postError) {
    console.error("Missing Playbill song-list notice could not be posted", {
      applicationId,
      message: postError.message,
    });
    return;
  }

  revalidatePath("/portal/chat");
  revalidatePath("/portal/notifications");
}

function isMissingSongListCache(error: { code?: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function apiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const candidate = payload as {
    error?: { message?: string } | string;
    message?: string;
  };
  if (typeof candidate.error === "string" && candidate.error.trim()) {
    return candidate.error.trim();
  }
  if (candidate.error && typeof candidate.error === "object") {
    if (candidate.error.message?.trim()) return candidate.error.message.trim();
  }
  return candidate.message?.trim() || fallback;
}

function sourceFileName(file: PlaybillFileRow) {
  return (
    file.display_name?.trim() ||
    file.generated_name.trim() ||
    file.original_name.trim() ||
    "Uploaded Playbill"
  );
}

function extractionResponse({
  cached,
  extractedAt,
  file,
  songs,
}: {
  cached: boolean;
  extractedAt: string;
  file: PlaybillFileRow;
  songs: PlaybillSong[];
}) {
  return NextResponse.json(
    {
      cached,
      extractedAt,
      songs,
      sourceFileName: sourceFileName(file),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  const { applicationId } = await context.params;
  if (!UUID_PATTERN.test(applicationId)) {
    return NextResponse.json({ error: "Invalid application." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const requestBody = (await request.json().catch(() => null)) as
    | { background?: unknown; portalFileId?: unknown }
    | null;
  const background = requestBody?.background === true;
  const portalFileId =
    typeof requestBody?.portalFileId === "string"
      ? requestBody.portalFileId
      : "";
  if (background && !UUID_PATTERN.test(portalFileId)) {
    return NextResponse.json(
      { error: "A valid uploaded Playbill is required." },
      { status: 400 },
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    return NextResponse.json(
      { error: "Your adjudication access could not be checked." },
      { status: 500 },
    );
  }
  if (
    !profile?.active ||
    (!background && !ADJUDICATION_ROLES.has(profile.role))
  ) {
    return NextResponse.json(
      { error: "You do not have access to this adjudication session." },
      { status: 403 },
    );
  }

  const admin = createAdminClient();

  try {
    const { data: visibleApplication, error: visibleApplicationError } =
      await supabase
        .from("applications")
        .select("id")
        .eq("id", applicationId)
        .maybeSingle();
    if (visibleApplicationError) throw new Error(visibleApplicationError.message);

    let hasAccess =
      background || profile.role === "owner" || Boolean(visibleApplication);
    if (!hasAccess && profile.role !== "owner") {
      const observerAccess = await resolveAdjudicationObserverAccess({
        admin,
        applicationId,
        userId: user.id,
      });
      hasAccess = observerAccess.allowed;
    }

    if (!hasAccess) {
      return NextResponse.json(
        { error: "You do not have access to this adjudication session." },
        { status: 403 },
      );
    }

    const { data: applicationExists, error: applicationError } = await admin
      .from("applications")
      .select("id")
      .eq("id", applicationId)
      .maybeSingle();
    if (applicationError) throw new Error(applicationError.message);
    if (!applicationExists) {
      return NextResponse.json(
        { error: "The application could not be found." },
        { status: 404 },
      );
    }

    let fileQuery = admin
      .from("portal_files")
      .select(
        "id,display_name,file_size,generated_name,mime_type,original_name,storage_path,uploaded_by",
      )
      .eq("application_id", applicationId)
      .eq("context_type", "application")
      .eq("document_category", "playbill")
      .eq("reviewer_visible", true)
      .is("archived_at", null);
    fileQuery = background
      ? fileQuery.eq("id", portalFileId)
      : fileQuery.order("created_at", { ascending: false });
    const { data: fileData, error: fileError } = await fileQuery
      .limit(1)
      .maybeSingle();
    if (fileError) throw new Error(fileError.message);
    if (!fileData) {
      return NextResponse.json(
        { error: "No reviewer-visible Playbill has been uploaded for this show." },
        { status: 404 },
      );
    }
    const file = fileData as PlaybillFileRow;
    if (
      background &&
      profile.role !== "owner" &&
      file.uploaded_by !== user.id
    ) {
      return NextResponse.json(
        { error: "You can only process a Playbill you uploaded." },
        { status: 403 },
      );
    }

    const executeExtraction = async () => {

    const { data: cachedData, error: cacheError } = await admin
      .from("playbill_song_lists")
      .select("songs,extracted_at")
      .eq("portal_file_id", file.id)
      .eq("extractor_version", PLAYBILL_SONG_LIST_EXTRACTOR_VERSION)
      .maybeSingle();
    const cacheAvailable = !isMissingSongListCache(cacheError);
    if (cacheError && cacheAvailable) throw new Error(cacheError.message);
    if (cachedData) {
      const cachedSongs = parsePlaybillSongList({ songs: cachedData.songs });
      if (cachedSongs) {
        if (background && cachedSongs.length === 0) {
          await postMissingSongListNotice({
            admin,
            applicationId,
            authorId: user.id,
            file,
          });
        }
        return extractionResponse({
          cached: true,
          extractedAt: cachedData.extracted_at,
          file,
          songs: cachedSongs,
        });
      }
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Automatic Playbill song-list extraction is not configured." },
        { status: 503 },
      );
    }

    const inputKind = resolvePlaybillInputKind({
      fileName: file.original_name || file.generated_name,
      mimeType: file.mime_type,
    });
    if (!inputKind) {
      return NextResponse.json(
        { error: "This Playbill format cannot be read automatically. Upload a PDF, PNG, JPG, WEBP, or GIF." },
        { status: 415 },
      );
    }
    if (file.file_size && file.file_size >= MAX_PLAYBILL_BYTES) {
      return NextResponse.json(
        { error: "This Playbill is too large for automatic reading. Upload an optimized file under 50 MB." },
        { status: 413 },
      );
    }

    if (!(await consumeApiQuota(supabase, "playbill_song_list", 10))) {
      return NextResponse.json(
        { error: "The Playbill reader is busy. Try again in about an hour." },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }

    const { data: playbillBlob, error: downloadError } = await admin.storage
      .from("portal-files")
      .download(file.storage_path);
    if (downloadError || !playbillBlob) {
      throw new Error(downloadError?.message || "The Playbill could not be downloaded.");
    }
    const playbillBytes = Buffer.from(await playbillBlob.arrayBuffer());
    if (playbillBytes.byteLength >= MAX_PLAYBILL_BYTES) {
      return NextResponse.json(
        { error: "This Playbill is too large for automatic reading. Upload an optimized file under 50 MB." },
        { status: 413 },
      );
    }

    const dataUrl = `data:${inputKind.mimeType};base64,${playbillBytes.toString("base64")}`;
    const fileContent =
      inputKind.kind === "pdf"
        ? {
            type: "input_file",
            filename: file.original_name || "playbill.pdf",
            file_data: dataUrl,
            detail: "high",
          }
        : {
            type: "input_image",
            image_url: dataUrl,
            detail: "high",
          };

    const response = await fetch(RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PLAYBILL_SONG_LIST_MODEL,
        store: false,
        safety_identifier: createHash("sha256")
          .update(user.id)
          .digest("hex")
          .slice(0, 64),
        max_output_tokens: 5000,
        reasoning: { effort: OPENAI_REASONING_EFFORT.playbillSongList },
        text: {
          format: {
            type: "json_schema",
            name: "playbill_song_list",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["songs"],
              properties: {
                songs: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["section", "title", "performers"],
                    properties: {
                      section: { type: "string" },
                      title: { type: "string" },
                      performers: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          verbosity: "low",
        },
        instructions: PLAYBILL_SONG_LIST_INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: PLAYBILL_SONG_LIST_REQUEST,
              },
              fileContent,
            ],
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(240_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const upstreamError = apiError(payload, "The Playbill could not be read.");
      console.error("Playbill song-list extraction failed", {
        applicationId,
        fileId: file.id,
        message: upstreamError,
        status: response.status,
      });
      return NextResponse.json(
        {
          error:
            response.status === 429
              ? "The Playbill reader is busy. Please try again shortly."
              : "The Playbill could not be read automatically. Please try again.",
        },
        {
          status: response.status === 429 ? 429 : 502,
          headers: response.status === 429 ? { "Retry-After": "60" } : undefined,
        },
      );
    }

    await recordAiRequestUsage({
      feature: "playbill_song_list",
      fallbackModel: PLAYBILL_SONG_LIST_MODEL,
      requestedBy: user.id,
      applicationId,
      portalFileId: file.id,
      usage: parseOpenAIResponseUsage(payload),
      metadata: { sourceFileName: sourceFileName(file) },
    });

    const outputText = extractOpenAIText(payload);
    let structuredOutput: unknown = null;
    try {
      structuredOutput = JSON.parse(outputText);
    } catch {
      structuredOutput = null;
    }
    const songs = parsePlaybillSongList(structuredOutput);
    if (!songs) {
      console.error("Playbill song-list extraction returned invalid output", {
        applicationId,
        fileId: file.id,
      });
      return NextResponse.json(
        { error: "The Playbill reader returned an incomplete result. Please try again." },
        { status: 502 },
      );
    }

    const extractedAt = new Date().toISOString();
    if (cacheAvailable) {
      const { error: saveError } = await admin
        .from("playbill_song_lists")
        .upsert(
          {
            application_id: applicationId,
            portal_file_id: file.id,
            songs,
            extractor_version: PLAYBILL_SONG_LIST_EXTRACTOR_VERSION,
            model: PLAYBILL_SONG_LIST_MODEL,
            extracted_by: user.id,
            extracted_at: extractedAt,
          },
          { onConflict: "portal_file_id" },
        );
      if (saveError) throw new Error(saveError.message);
    }

    if (background && songs.length === 0) {
      await postMissingSongListNotice({
        admin,
        applicationId,
        authorId: user.id,
        file,
      });
    }

    return extractionResponse({
      cached: false,
      extractedAt,
      file,
      songs,
    });
    };

    if (background) {
      after(async () => {
        try {
          await executeExtraction();
        } catch (error) {
          console.error("Background Playbill song-list extraction failed", {
            applicationId,
            fileId: file.id,
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      });
      return NextResponse.json(
        { processing: true, portalFileId: file.id },
        { status: 202 },
      );
    }

    return executeExtraction();
  } catch (error) {
    console.error("Playbill song-list request failed", {
      applicationId,
      message: error instanceof Error ? error.message : "Unknown error",
      userId: user.id,
    });
    return NextResponse.json(
      { error: "The Playbill song list is temporarily unavailable." },
      { status: 500 },
    );
  }
}
