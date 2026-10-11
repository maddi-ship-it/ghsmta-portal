import { NextResponse } from "next/server";

import {
  attachmentDisposition,
  createSchoolFileZipStream,
  MAX_SCHOOL_FILE_DOWNLOADS,
  parseSchoolFileIds,
  uniqueSchoolFileNames,
} from "@/lib/school-file-download";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DownloadFile = {
  id: string;
  original_name: string;
  storage_path: string;
};

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function signedFileSources(
  supabase: Awaited<ReturnType<typeof createClient>>,
  files: DownloadFile[],
) {
  const archiveNames = uniqueSchoolFileNames(
    files.map((file) => file.original_name),
  );

  return Promise.all(
    files.map(async (file, index) => {
      const { data, error } = await supabase.storage
        .from("portal-files")
        .createSignedUrl(file.storage_path, 5 * 60);

      if (error || !data?.signedUrl) {
        throw new Error(`Could not prepare ${file.original_name} for download.`);
      }

      return { name: archiveNames[index], url: data.signedUrl };
    }),
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorResponse("Authentication required.", 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("active")
    .eq("id", user.id)
    .single();
  if (!profile?.active) return errorResponse("Portal access is required.", 403);

  const formData = await request.formData();
  const fileIds = parseSchoolFileIds(formData.get("file_ids"));
  if (fileIds.length === 0) {
    return errorResponse("Choose at least one school file.", 400);
  }
  if (fileIds.length > MAX_SCHOOL_FILE_DOWNLOADS) {
    return errorResponse(
      `Choose no more than ${MAX_SCHOOL_FILE_DOWNLOADS} school files at once.`,
      400,
    );
  }

  const { data, error } = await supabase
    .from("portal_files")
    .select("id,original_name,storage_path")
    .in("id", fileIds)
    .eq("context_type", "application")
    .is("archived_at", null);

  if (error) return errorResponse("The school files could not be loaded.", 500);

  const fileMap = new Map(
    ((data ?? []) as DownloadFile[]).map((file) => [file.id, file]),
  );
  const files = fileIds
    .map((fileId) => fileMap.get(fileId))
    .filter((file): file is DownloadFile => Boolean(file));

  if (files.length !== fileIds.length) {
    return errorResponse("One or more school files are no longer available.", 404);
  }

  try {
    const sources = await signedFileSources(supabase, files);

    if (files.length === 1) {
      const response = await fetch(sources[0].url, { cache: "no-store" });
      if (!response.ok || !response.body) {
        return errorResponse("The school file could not be downloaded.", 502);
      }

      return new Response(response.body, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": attachmentDisposition(sources[0].name),
          "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
        },
      });
    }

    return new Response(createSchoolFileZipStream(sources), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": attachmentDisposition("ghsmta-school-files.zip"),
        "Content-Type": "application/zip",
      },
    });
  } catch (caught) {
    return errorResponse(
      caught instanceof Error
        ? caught.message
        : "The school files could not be prepared for download.",
      502,
    );
  }
}
