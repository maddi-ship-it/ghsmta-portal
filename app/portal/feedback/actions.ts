"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type FeedbackActionResult = {
  ok: boolean;
  error?: string;
  requestId?: string;
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
  const { data: request, error } = await supabase
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
      status: "new",
    })
    .select("id,reference_code")
    .single();

  if (error || !request) {
    return { ok: false, error: error?.message ?? "Could not submit your request." };
  }

  revalidatePath("/portal/feedback");
  revalidatePath("/portal/admin/workflows");
  return {
    ok: true,
    requestId: request.id as string,
    referenceCode: request.reference_code as string,
  };
}

export async function updatePortalFeedbackRequest(
  requestId: string,
  formData: FormData,
) {
  await requireProfile(["owner"]);
  const status = text(formData, "status");
  const ownerNotes = text(formData, "owner_notes");
  const allowed = ["new", "needs_information", "reviewing", "planned", "in_progress", "resolved", "closed"];
  if (!allowed.includes(status)) throw new Error("Invalid request status.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("portal_feedback_requests")
    .update({ status, owner_notes: ownerNotes || null })
    .eq("id", requestId);
  if (error) throw new Error(error.message);
  revalidatePath("/portal/feedback");
  revalidatePath("/portal/admin/workflows");
}
