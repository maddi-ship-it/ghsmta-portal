"use client";

import { Upload } from "tus-js-client";

import { buildGeneratedFileName } from "@/lib/file-naming";
import { SCHOOL_FILE_MAX_FILE_BYTES } from "@/lib/file-upload-policy";
import { createClient } from "@/lib/supabase/client";

const DEFAULT_PORTAL_FILE_MAX_BYTES = 50 * 1024 * 1024;
const RESUMABLE_CHUNK_SIZE = 6 * 1024 * 1024;

function resumableStorageEndpoint() {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!projectUrl) {
    throw new Error("Supabase storage is not configured.");
  }

  const url = new URL(projectUrl);
  if (url.hostname.endsWith(".supabase.co")) {
    const projectRef = url.hostname.split(".")[0];
    return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  }

  return new URL("/storage/v1/upload/resumable", url).toString();
}

async function uploadPortalFileResumable({
  accessToken,
  file,
  publishableKey,
  storagePath,
}: {
  accessToken: string;
  file: File;
  publishableKey: string;
  storagePath: string;
}) {
  let resolvedStoragePath = storagePath;

  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: resumableStorageEndpoint(),
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: publishableKey,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: RESUMABLE_CHUNK_SIZE,
      metadata: {
        bucketName: "portal-files",
        objectName: resolvedStoragePath,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onError: reject,
      onSuccess: () => resolve(),
    });

    void upload
      .findPreviousUploads()
      .then((previousUploads) => {
        const previousUpload = previousUploads.find(
          (candidate) =>
            candidate.metadata.bucketName === "portal-files" &&
            Boolean(candidate.metadata.objectName),
        );
        if (previousUpload) {
          resolvedStoragePath = previousUpload.metadata.objectName;
          upload.resumeFromPreviousUpload(previousUpload);
        }
        upload.start();
      })
      .catch(reject);
  });

  return resolvedStoragePath;
}

export type PortalFileContext =
  | "appeal"
  | "bug_report"
  | "feature_request"
  | "application"
  | "scholarship_request"
  | "student_profile"
  | "student_submission";

export async function uploadPortalFiles({
  files,
  contextType,
  contextId,
  applicationId,
  userId,
  season,
  program,
  school,
  documentType,
  documentCategory = "other",
  reviewerVisible = true,
  metadata = {},
}: {
  files: File[];
  contextType: PortalFileContext;
  contextId: string;
  applicationId?: string | null;
  userId: string;
  season?: string | null;
  program?: string | null;
  school?: string | null;
  documentType: string;
  documentCategory?: string;
  reviewerVisible?: boolean;
  metadata?: {
    displayName?: string | null;
    personName?: string | null;
    awardCategory?: string | null;
    roleOrCharacter?: string | null;
    designerName?: string | null;
    phoneticSpelling?: string | null;
    fileNotes?: string | null;
    productionName?: string | null;
  };
}) {
  const supabase = createClient();
  const uploaded: Array<{ id: string; generatedName: string }> = [];

  for (const file of files) {
    const maximumFileBytes =
      contextType === "application"
        ? SCHOOL_FILE_MAX_FILE_BYTES
        : DEFAULT_PORTAL_FILE_MAX_BYTES;
    const maximumFileMegabytes = maximumFileBytes / (1024 * 1024);

    if (file.size > maximumFileBytes) {
      throw new Error(
        `${file.name} is larger than ${maximumFileMegabytes} MB.`,
      );
    }

    const generatedName = buildGeneratedFileName({
      season,
      program,
      school,
      documentType,
      originalName: file.name,
    });
    let storagePath = `${userId}/${contextType}/${contextId}/${crypto.randomUUID()}-${generatedName}`;

    if (file.size > RESUMABLE_CHUNK_SIZE) {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

      if (sessionError || !accessToken || !publishableKey) {
        throw new Error(
          sessionError?.message ??
            "Your upload session is unavailable. Sign in again and retry.",
        );
      }

      storagePath = await uploadPortalFileResumable({
        accessToken,
        file,
        publishableKey,
        storagePath,
      });
    } else {
      const { error: uploadError } = await supabase.storage
        .from("portal-files")
        .upload(storagePath, file, {
          contentType: file.type || undefined,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw new Error(uploadError.message);
    }

    const { data, error: metadataError } = await supabase
      .from("portal_files")
      .insert({
        context_type: contextType,
        context_id: contextId,
        application_id: applicationId ?? null,
        original_name: file.name,
        generated_name: generatedName,
        storage_path: storagePath,
        mime_type: file.type || null,
        file_size: file.size,
        uploaded_by: userId,
        document_category: documentCategory,
        reviewer_visible: reviewerVisible,
        display_name: metadata.displayName ?? null,
        person_name: metadata.personName ?? null,
        award_category: metadata.awardCategory ?? null,
        role_or_character: metadata.roleOrCharacter ?? null,
        designer_name: metadata.designerName ?? null,
        phonetic_spelling: metadata.phoneticSpelling ?? null,
        file_notes: metadata.fileNotes ?? null,
        production_name: metadata.productionName ?? null,
      })
      .select("id")
      .single();

    if (metadataError) {
      await supabase.storage.from("portal-files").remove([storagePath]);
      throw new Error(metadataError.message);
    }

    uploaded.push({ id: data.id as string, generatedName });
  }

  return uploaded;
}
