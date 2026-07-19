"use client";

import { buildGeneratedFileName } from "@/lib/file-naming";
import { createClient } from "@/lib/supabase/client";

export type PortalFileContext = "appeal" | "bug_report" | "feature_request" | "application";

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
    if (file.size > 50 * 1024 * 1024) {
      throw new Error(`${file.name} is larger than 50 MB.`);
    }

    const generatedName = buildGeneratedFileName({
      season,
      program,
      school,
      documentType,
      originalName: file.name,
    });
    const storagePath = `${userId}/${contextType}/${contextId}/${crypto.randomUUID()}-${generatedName}`;

    const { error: uploadError } = await supabase.storage
      .from("portal-files")
      .upload(storagePath, file, {
        contentType: file.type || undefined,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) throw new Error(uploadError.message);

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
