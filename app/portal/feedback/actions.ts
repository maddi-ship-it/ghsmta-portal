"use server";

import { buildGeneratedFileName } from "@/lib/file-naming";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type FeedbackActionResult = {
  ok: boolean;
  error?: string;
  referenceCode?: string;
};

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function submitPortalFeedback(
  formData: FormData,
): Promise<FeedbackActionResult> {
  const profile = await requireProfile();
  const requestType = text(formData, "request_type");
  const title = text(formData, "title");
  const description = text(formData, "description");
  const priority = text(formData, "priority") || "normal";

  if (!["bug_report", "feature_request"].includes(requestType)) {
    return { ok: false, error: "Choose a valid request type." };
  }

  if (title.length < 3 || title.length > 180) {
    return { ok: false, error: "Enter a clear title between 3 and 180 characters." };
  }

  if (description.length < 10 || description.length > 10000) {
    return { ok: false, error: "Add a detailed description between 10 and 10,000 characters." };
  }

  if (!["low", "normal", "high", "urgent"].includes(priority)) {
    return { ok: false, error: "Choose a valid priority." };
  }

  const supabase = await createClient();
  const width = Number(text(formData, "screen_width"));
  const height = Number(text(formData, "screen_height"));

  const { data: request, error: requestError } = await supabase
    .from("portal_feedback_requests")
    .insert({
      request_type: requestType,
      title,
      description,
      priority,
      page_url: text(formData, "page_url") || null,
      browser_info: text(formData, "browser_info") || null,
      screen_width: Number.isFinite(width) && width > 0 ? width : null,
      screen_height: Number.isFinite(height) && height > 0 ? height : null,
      client_context: {
        path: text(formData, "page_path") || null,
        role: profile.role,
      },
      submitted_by: profile.id,
    })
    .select("id,reference_code")
    .single();

  if (requestError || !request) {
    return {
      ok: false,
      error: requestError?.message ?? "Could not submit your request.",
    };
  }

  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);

  try {
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) {
        throw new Error(`${file.name} is larger than 50 MB.`);
      }

      const generatedName = buildGeneratedFileName({
        documentType:
          requestType === "bug_report" ? "Bug-Report" : "Feature-Request",
        originalName: file.name,
      });
      const storagePath = `${profile.id}/${requestType}/${request.id}/${crypto.randomUUID()}-${generatedName}`;

      const { error: uploadError } = await supabase.storage
        .from("portal-files")
        .upload(storagePath, file, {
          contentType: file.type || undefined,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { error: metadataError } = await supabase.from("portal_files").insert({
        context_type: requestType,
        context_id: request.id,
        original_name: file.name,
        generated_name: generatedName,
        storage_path: storagePath,
        mime_type: file.type || null,
        file_size: file.size,
        uploaded_by: profile.id,
        document_category: "feedback",
        reviewer_visible: false,
      });

      if (metadataError) {
        await supabase.storage.from("portal-files").remove([storagePath]);
        throw new Error(metadataError.message);
      }
    }
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error
          ? `The request was saved, but an attachment failed: ${caught.message}`
          : "The request was saved, but an attachment failed.",
      referenceCode: request.reference_code as string,
    };
  }

  return {
    ok: true,
    referenceCode: request.reference_code as string,
  };
}
