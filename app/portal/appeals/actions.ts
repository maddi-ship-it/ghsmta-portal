"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import {
  buildEligibilityAppealDecisionMessage,
  type EligibilityAppealDecision,
} from "@/lib/eligibility-appeal-decision";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AppealActionResult = {
  ok: boolean;
  id?: string;
  error?: string;
  message?: string;
};

function amountToCents(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter the requested amount as dollars and cents.");
  }
  return Math.round(Number(normalized) * 100);
}

async function postEligibilityAppealToPanel(
  appealId: string,
  applicantId: string,
) {
  const admin = createAdminClient();
  const { data: appeal, error: appealError } = await admin
    .from("appeals")
    .select(
      "application_id,category_id,current_eligibility,requested_eligibility,explanation",
    )
    .eq("id", appealId)
    .eq("appeal_type", "eligibility")
    .single();

  if (appealError || !appeal) {
    console.error("Unable to load the submitted eligibility appeal for the panel channel.", {
      appealId,
      appealError,
    });
    return;
  }

  const [channelResult, categoryResult] = await Promise.all([
    admin
      .from("chat_channels")
      .select("id")
      .eq("application_id", appeal.application_id)
      .eq("channel_type", "school")
      .eq("active", true)
      .maybeSingle(),
    appeal.category_id
      ? admin
          .from("scoring_categories")
          .select("title")
          .eq("id", appeal.category_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (channelResult.error || !channelResult.data) {
    console.error("Unable to locate the panel channel for an eligibility appeal.", {
      appealId,
      applicationId: appeal.application_id,
      channelError: channelResult.error,
    });
    return;
  }

  if (categoryResult.error) {
    console.error("Unable to resolve the eligibility appeal category for the panel post.", {
      appealId,
      categoryError: categoryResult.error,
    });
  }

  const categoryTitle = categoryResult.data?.title?.trim() || "Category";
  const appealExplanation = appeal.explanation.trim().slice(0, 4400);
  const body = [
    `An eligibility appeal was submitted for ${categoryTitle}.`,
    `Current eligibility status: ${appeal.current_eligibility ? "YES" : "NO"}`,
    `Requested eligibility status: ${appeal.requested_eligibility ? "YES" : "NO"}`,
    "",
    "Appeal explanation:",
    appealExplanation,
    "",
    "Review this appeal in School Requests.",
    `Appeal reference: ${appealId}`,
  ].join("\n");
  const { error: postError } = await admin.from("chat_posts").insert({
    channel_id: channelResult.data.id,
    author_id: applicantId,
    subject: `Eligibility appeal submitted: ${categoryTitle}`.slice(0, 180),
    body,
  });

  if (postError) {
    console.error("Unable to post the eligibility appeal in the panel channel.", {
      appealId,
      postError,
    });
    return;
  }

  revalidatePath("/portal/chat");
  revalidatePath("/portal/notifications");
}

export async function createEligibilityAppeal(formData: FormData): Promise<AppealActionResult> {
  const profile = await requireProfile(["applicant"]);
  const supabase = await createClient();
  const applicationId = String(formData.get("application_id") ?? "");
  const { data, error } = await supabase.rpc("submit_eligibility_appeal", {
    p_application_id: applicationId,
    p_category_id: String(formData.get("category_id") ?? ""),
    p_explanation: String(formData.get("explanation") ?? ""),
    p_current_eligibility: String(formData.get("current_eligibility") ?? "false") === "true",
    p_contact_name: String(formData.get("school_contact_name") ?? ""),
    p_contact_email: String(formData.get("school_contact_email") ?? ""),
    p_contact_phone: String(formData.get("school_contact_phone") ?? ""),
    p_certification_accepted: formData.get("certification_accepted") === "on",
  });
  if (error) return { ok: false, error: error.message };
  await postEligibilityAppealToPanel(String(data), profile.id);
  revalidatePath("/portal/appeals");
  revalidatePath(`/portal/applications/${applicationId}`);
  revalidatePath(`/portal/adjudication/${applicationId}`);
  return { ok: true, id: String(data) };
}

export async function reviewEligibilityAppeal(
  appealId: string,
  formData: FormData,
): Promise<AppealActionResult> {
  const profile = await requireProfile(["advisory_member", "owner"]);
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: appeal, error: appealError } = await admin
    .from("appeals")
    .select(
      "application_id,category_id,current_eligibility,school_contact_name,status",
    )
    .eq("appeal_type", "eligibility")
    .eq("id", appealId)
    .single();
  if (appealError || !appeal) {
    return {
      ok: false,
      error: appealError?.message ?? "Eligibility appeal not found.",
    };
  }

  if (["resolved", "denied"].includes(appeal.status)) {
    return { ok: false, error: "This eligibility appeal is already closed." };
  }

  let status = String(formData.get("status") ?? "submitted");
  let resolution = "";

  if (profile.role === "owner") {
    const rawDecision = String(formData.get("decision") ?? "");
    if (rawDecision !== "approved" && rawDecision !== "denied") {
      return { ok: false, error: "Choose Approved or Denied." };
    }
    const decision: EligibilityAppealDecision = rawDecision;

    const [applicationResult, categoryResult] = await Promise.all([
      admin
        .from("applications")
        .select("school_name,production_title")
        .eq("id", appeal.application_id)
        .single(),
      appeal.category_id
        ? admin
            .from("scoring_categories")
            .select("title")
            .eq("id", appeal.category_id)
            .single()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (applicationResult.error || !applicationResult.data) {
      return {
        ok: false,
        error:
          applicationResult.error?.message ?? "Application details were not found.",
      };
    }
    if (categoryResult.error || !categoryResult.data) {
      return {
        ok: false,
        error:
          categoryResult.error?.message ?? "Appeal category details were not found.",
      };
    }

    status = decision === "approved" ? "resolved" : "denied";
    resolution = buildEligibilityAppealDecisionMessage({
      categoryTitle: categoryResult.data.title,
      contactName: appeal.school_contact_name,
      currentEligibility: appeal.current_eligibility,
      decision,
      productionTitle: applicationResult.data.production_title,
      schoolName: applicationResult.data.school_name,
    });
  }

  const { error } = await supabase.rpc("review_eligibility_appeal", {
    p_appeal_id: appealId,
    p_status: status,
    p_advisory_notes: String(formData.get("advisory_notes") ?? ""),
    p_owner_notes: String(formData.get("owner_notes") ?? ""),
    p_resolution: resolution,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/portal/appeals");
  revalidatePath(`/portal/applications/${appeal.application_id}`);
  revalidatePath(`/portal/adjudication/${appeal.application_id}`);
  revalidatePath("/portal/chat");
  revalidatePath("/portal/notifications");
  return {
    ok: true,
    message:
      profile.role === "owner"
        ? `Appeal ${status === "resolved" ? "approved" : "denied"}. The school and review channels were notified.`
        : "Eligibility appeal review saved.",
  };
}

export async function createScholarshipRequest(formData: FormData): Promise<AppealActionResult> {
  await requireProfile(["applicant"]);
  const supabase = await createClient();

  let amountRequestedCents: number | null = null;
  try {
    amountRequestedCents = amountToCents(formData.get("amount_requested"));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid requested amount." };
  }

  const { data, error } = await supabase.rpc("submit_scholarship_request", {
    p_application_id: String(formData.get("application_id") ?? ""),
    p_request_type: String(formData.get("request_type") ?? "program_fee"),
    p_amount_requested_cents: amountRequestedCents,
    p_explanation: String(formData.get("explanation") ?? ""),
    p_financial_context: String(formData.get("financial_context") ?? ""),
    p_contact_name: String(formData.get("school_contact_name") ?? ""),
    p_contact_email: String(formData.get("school_contact_email") ?? ""),
    p_contact_phone: String(formData.get("school_contact_phone") ?? ""),
    p_certification_accepted: formData.get("certification_accepted") === "on",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/portal/appeals");
  return { ok: true, id: String(data) };
}

export async function reviewScholarshipRequest(requestId: string, formData: FormData) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_scholarship_request", {
    p_request_id: requestId,
    p_status: String(formData.get("status") ?? "submitted"),
    p_owner_notes: String(formData.get("owner_notes") ?? ""),
    p_resolution: String(formData.get("resolution") ?? ""),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/portal/appeals");
}
