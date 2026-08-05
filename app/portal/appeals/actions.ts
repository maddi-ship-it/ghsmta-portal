"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type AppealActionResult = { ok: boolean; id?: string; error?: string };

function amountToCents(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter the requested amount as dollars and cents.");
  }
  return Math.round(Number(normalized) * 100);
}

export async function createEligibilityAppeal(formData: FormData): Promise<AppealActionResult> {
  await requireProfile(["applicant"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_eligibility_appeal", {
    p_application_id: String(formData.get("application_id") ?? ""),
    p_category_id: String(formData.get("category_id") ?? ""),
    p_explanation: String(formData.get("explanation") ?? ""),
    p_current_eligibility: String(formData.get("current_eligibility") ?? "false") === "true",
    p_contact_name: String(formData.get("school_contact_name") ?? ""),
    p_contact_email: String(formData.get("school_contact_email") ?? ""),
    p_contact_phone: String(formData.get("school_contact_phone") ?? ""),
    p_certification_accepted: formData.get("certification_accepted") === "on",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/portal/appeals");
  return { ok: true, id: String(data) };
}

export async function reviewEligibilityAppeal(appealId: string, formData: FormData) {
  await requireProfile(["advisory_member", "owner"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_eligibility_appeal", {
    p_appeal_id: appealId,
    p_status: String(formData.get("status") ?? "submitted"),
    p_advisory_notes: String(formData.get("advisory_notes") ?? ""),
    p_owner_notes: String(formData.get("owner_notes") ?? ""),
    p_resolution: String(formData.get("resolution") ?? ""),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/portal/appeals");
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
