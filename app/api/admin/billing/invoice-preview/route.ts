import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createInvoicePdf } from "@/lib/reports/invoice-pdf";
import { createClient } from "@/lib/supabase/server";
import type { InvoiceContext } from "@/lib/billing/types";
import {
  DEFAULT_INVOICE_PAYMENT_URL,
  loadBillingApplicationDetails,
} from "@/lib/billing/application-details";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function validHttpsUrl(url: string) {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function previewError(message: string, status = 400) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return previewError("Authentication required.", 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role,active")
    .eq("id", user.id)
    .single();
  if (!profile?.active || profile.role !== "owner") {
    return previewError("Owner access required.", 403);
  }

  const formData = await request.formData();
  const optionId = value(formData, "option_id");
  const applicationId =
    value(formData, "application_id") ||
    formData.getAll("application_ids").map(String).find(Boolean) ||
    "";
  if (!optionId || !applicationId) {
    return previewError("Choose a school and pricing option first.");
  }

  const [{ data: application }, { data: option }] = await Promise.all([
    supabase
      .from("applications")
      .select("id,cycle_id,school_name,production_title,external_applicant_email,form_version_id")
      .eq("id", applicationId)
      .eq("is_archived", false)
      .single(),
    supabase
      .from("cycle_invoice_options")
      .select("id,cycle_id,option_key,label,amount_cents,active,payment_url,promo_code")
      .eq("id", optionId)
      .single(),
  ]);
  if (
    !application ||
    !option ||
    !option.active ||
    application.cycle_id !== option.cycle_id
  ) {
    return previewError("The school and pricing option must be in the same active cycle.");
  }

  const { data: cycle } = await supabase
    .from("award_cycles")
    .select("name,season_year")
    .eq("id", application.cycle_id)
    .single();
  if (!cycle) return previewError("Cycle details were not found.", 404);

  let recipientEmail = value(formData, "recipient_email").toLowerCase();
  if (!recipientEmail) {
    const { data: members } = await supabase
      .from("application_members")
      .select("member_role,profiles!application_members_user_id_fkey(email)")
      .eq("application_id", application.id)
      .eq("active", true);
    type Member = {
      member_role: string;
      profiles:
        | { email: string | null }
        | Array<{ email: string | null }>
        | null;
    };
    const orderedMembers = ((members ?? []) as unknown as Member[]).sort(
      (left, right) =>
        Number(right.member_role === "primary") -
        Number(left.member_role === "primary"),
    );
    for (const member of orderedMembers) {
      const memberProfile = Array.isArray(member.profiles)
        ? member.profiles[0]
        : member.profiles;
      if (memberProfile?.email) {
        recipientEmail = memberProfile.email.toLowerCase();
        break;
      }
    }
    recipientEmail ||= application.external_applicant_email?.toLowerCase() ?? "";
  }
  if (!/^\S+@\S+\.\S+$/.test(recipientEmail)) {
    return previewError("The selected school needs a valid billing contact email.");
  }

  const applicationDetails = (
    await loadBillingApplicationDetails(supabase, [application])
  ).get(application.id);
  const paymentUrl =
    value(formData, "payment_url") ||
    option.payment_url ||
    DEFAULT_INVOICE_PAYMENT_URL;
  if (option.amount_cents > 0 && !validHttpsUrl(paymentUrl)) {
    return previewError("Paid invoices require a secure https payment link.");
  }

  const now = new Date();
  const dueDateInput = value(formData, "due_date");
  const dueDate = dueDateInput
    ? new Date(`${dueDateInput}T23:59:59`)
    : new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  if (Number.isNaN(dueDate.getTime())) {
    return previewError("Enter a valid due date.");
  }

  const scholarshipConfirmation =
    option.amount_cents === 0 &&
    formData.get("scholarship_confirmation") === "on";
  const context: InvoiceContext = {
    id: "preview",
    invoice_number: "DRAFT PREVIEW",
    cycle_id: application.cycle_id,
    application_id: application.id,
    option_key: option.option_key,
    description_snapshot: option.label,
    amount_cents: option.amount_cents,
    currency: "usd",
    document_kind: scholarshipConfirmation
      ? "scholarship_confirmation"
      : "invoice",
    payment_url: option.amount_cents > 0 ? paymentUrl : null,
    payment_promo_code: option.promo_code ?? null,
    recipient_email: recipientEmail,
    billing_name: value(formData, "billing_name") || application.school_name,
    billing_address:
      value(formData, "billing_address") ||
      applicationDetails?.schoolAddress ||
      null,
    billing_contact_name: value(formData, "billing_contact_name") || null,
    billing_contact_phone:
      value(formData, "billing_contact_phone") ||
      applicationDetails?.schoolPhone ||
      null,
    school_address_snapshot: applicationDetails?.schoolAddress ?? null,
    school_phone_snapshot: applicationDetails?.schoolPhone ?? null,
    school_type_snapshot: applicationDetails?.schoolType ?? null,
    message_subject_snapshot: null,
    message_body_snapshot: null,
    status: "draft",
    issued_at: now.toISOString(),
    due_at: option.amount_cents > 0 ? dueDate.toISOString() : null,
    sent_at: null,
    paid_at: null,
    next_reminder_at: null,
    last_reminder_at: null,
    reminder_count: 0,
    delivery_status: "pending",
    last_delivery_at: null,
    reminder_claimed_at: null,
    reminder_claim_token: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    school_name: application.school_name,
    production_title: application.production_title,
    cycle_name: cycle.name,
    season_year: cycle.season_year,
  };

  let logoBytes: Uint8Array | undefined;
  try {
    logoBytes = await readFile(
      join(process.cwd(), "public", "artsbridge-foundation-logo.png"),
    );
  } catch {
    logoBytes = undefined;
  }

  const pdfBytes = await createInvoicePdf(context, logoBytes);
  return new Response(Buffer.from(pdfBytes), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'inline; filename="invoice-preview.pdf"',
      "Content-Length": String(pdfBytes.byteLength),
      "Content-Type": "application/pdf",
    },
  });
}
