"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { deliverSchoolInvoice } from "@/lib/billing/delivery";
import { defaultInvoiceMessageTemplates } from "@/lib/billing/delivery-copy";
import {
  DEFAULT_INVOICE_PAYMENT_URL,
  loadBillingApplicationDetails,
} from "@/lib/billing/application-details";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const BILLING_PATH = "/portal/admin/billing";
const BULK_LIMIT = 50;

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function billingRedirect(kind: "success" | "error", message: string): never {
  const query = new URLSearchParams({ [kind]: message });
  redirect(`${BILLING_PATH}?${query.toString()}`);
}

function parseDollars(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error("Enter a valid dollar amount with no more than two decimals.");
  }
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 10_000_000) {
    throw new Error("Enter an amount between $0 and $100,000.");
  }
  return cents;
}

function validHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function optionKeyFromLabel(label: string) {
  const base = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `custom_${base || "payment"}_${Date.now().toString(36)}`;
}

function selectedValues(formData: FormData, key: string) {
  return [...new Set(formData.getAll(key).map(String).filter(Boolean))];
}

function invoiceMessageTemplates(
  formData: FormData,
  documentKind: "invoice" | "scholarship_confirmation",
) {
  const defaults = defaultInvoiceMessageTemplates(documentKind);
  const subject = text(formData, "message_subject") || defaults.subject;
  const message = text(formData, "message_body") || defaults.message;

  if (subject.length < 3 || subject.length > 200 || /[\r\n]/.test(subject)) {
    billingRedirect(
      "error",
      "The email subject must be 3–200 characters and remain on one line.",
    );
  }
  if (message.length < 3 || message.length > 5_000) {
    billingRedirect("error", "The send message must be 3–5,000 characters.");
  }

  return { subject, message };
}

function parseDueDate(value: string, issuedAt: Date) {
  const defaultDue = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60_000);
  const parsedDue = value ? new Date(`${value}T23:59:59`) : defaultDue;
  if (Number.isNaN(parsedDue.getTime())) {
    billingRedirect("error", "Enter a valid due date.");
  }
  return parsedDue;
}

function revalidateBilling() {
  revalidatePath(BILLING_PATH);
  revalidatePath("/portal/invoices");
  revalidatePath("/portal/chat");
}

async function runInBatches<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
) {
  let completed = 0;
  let failed = 0;
  for (let index = 0; index < items.length; index += 5) {
    const results = await Promise.allSettled(
      items.slice(index, index + 5).map(worker),
    );
    completed += results.filter((result) => result.status === "fulfilled").length;
    failed += results.filter((result) => result.status === "rejected").length;
  }
  return { completed, failed };
}

export async function updateInvoiceOption(optionId: string, formData: FormData) {
  await requireProfile(["owner"]);
  const label = text(formData, "label");
  const amount = text(formData, "amount");
  const promoCode = text(formData, "promo_code").toUpperCase();
  const paymentUrl = text(formData, "payment_url") || DEFAULT_INVOICE_PAYMENT_URL;
  if (!label) billingRedirect("error", "Enter a pricing option label.");
  if (paymentUrl && !validHttpsUrl(paymentUrl)) {
    billingRedirect("error", "Payment links must start with https://.");
  }

  let amountCents: number;
  try {
    amountCents = parseDollars(amount);
  } catch (error) {
    billingRedirect("error", error instanceof Error ? error.message : "Invalid amount.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("cycle_invoice_options")
    .update({
      label,
      amount_cents: amountCents,
      active: formData.get("active") === "on",
      payment_url: paymentUrl || null,
      promo_code: promoCode || null,
    })
    .eq("id", optionId);
  if (error) billingRedirect("error", error.message);

  revalidatePath(BILLING_PATH);
  billingRedirect("success", "Cycle pricing updated.");
}

export async function createInvoiceOption(formData: FormData) {
  await requireProfile(["owner"]);
  const cycleId = text(formData, "cycle_id");
  const label = text(formData, "label");
  const amount = text(formData, "amount");
  const promoCode = text(formData, "promo_code").toUpperCase();
  const paymentUrl = text(formData, "payment_url") || DEFAULT_INVOICE_PAYMENT_URL;
  if (!cycleId || !label) billingRedirect("error", "Choose a cycle and add a payment label.");
  if (paymentUrl && !validHttpsUrl(paymentUrl)) {
    billingRedirect("error", "Payment links must start with https://.");
  }

  let amountCents: number;
  try {
    amountCents = parseDollars(amount);
  } catch (error) {
    billingRedirect("error", error instanceof Error ? error.message : "Invalid amount.");
  }

  const supabase = await createClient();
  const { data: maxOrder } = await supabase
    .from("cycle_invoice_options")
    .select("sort_order")
    .eq("cycle_id", cycleId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("cycle_invoice_options").insert({
    cycle_id: cycleId,
    option_key: optionKeyFromLabel(label),
    label,
    amount_cents: amountCents,
    promo_code: promoCode || null,
    payment_url: paymentUrl || null,
    active: true,
    sort_order: Number(maxOrder?.sort_order ?? 0) + 10,
  });
  if (error) billingRedirect("error", error.message);

  revalidatePath(BILLING_PATH);
  billingRedirect("success", "Payment amount added.");
}

export async function archiveInvoiceOption(optionId: string) {
  const owner = await requireProfile(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("cycle_invoice_options")
    .update({
      active: false,
      archived_at: new Date().toISOString(),
      archived_by: owner.id,
    })
    .eq("id", optionId)
    .is("archived_at", null);
  if (error) billingRedirect("error", error.message);

  revalidatePath(BILLING_PATH);
  billingRedirect("success", "Payment amount archived.");
}

export async function createAndSendInvoice(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const applicationId = text(formData, "application_id");
  const optionId = text(formData, "option_id");
  const recipientEmail = text(formData, "recipient_email").toLowerCase();
  const billingName = text(formData, "billing_name");
  const billingAddress = text(formData, "billing_address");
  const billingContactName = text(formData, "billing_contact_name");
  const billingContactPhone = text(formData, "billing_contact_phone");
  const paymentUrl = text(formData, "payment_url");
  const dueDate = text(formData, "due_date");

  if (!applicationId || !optionId || !recipientEmail) {
    billingRedirect("error", "Choose a school and price, then add the billing contact.");
  }
  if (!/^\S+@\S+\.\S+$/.test(recipientEmail)) {
    billingRedirect("error", "Enter a valid recipient email.");
  }

  const supabase = await createClient();
  const [{ data: application }, { data: option }] = await Promise.all([
    supabase
      .from("applications")
      .select("id,cycle_id,school_name,form_version_id")
      .eq("id", applicationId)
      .eq("is_archived", false)
      .single(),
    supabase
      .from("cycle_invoice_options")
      .select("id,cycle_id,option_key,label,amount_cents,active,payment_url,promo_code")
      .eq("id", optionId)
      .single(),
  ]);
  if (!application || !option || application.cycle_id !== option.cycle_id || !option.active) {
    billingRedirect("error", "That school and pricing option do not belong to the same active cycle.");
  }
  const resolvedPaymentUrl = paymentUrl || option.payment_url || DEFAULT_INVOICE_PAYMENT_URL;
  if (option.amount_cents > 0 && !validHttpsUrl(resolvedPaymentUrl)) {
    billingRedirect("error", "Paid invoices require a secure https payment link.");
  }
  const applicationDetails = (
    await loadBillingApplicationDetails(supabase, [application])
  ).get(application.id);
  const resolvedBillingName = billingName || application.school_name;
  const resolvedBillingAddress = billingAddress || applicationDetails?.schoolAddress || "";

  const { data: priorInvoices, error: priorInvoiceError } = await supabase
    .from("school_invoices")
    .select("id,status")
    .eq("application_id", application.id)
    .eq("cycle_id", application.cycle_id)
    .neq("status", "void")
    .limit(1);
  if (priorInvoiceError) billingRedirect("error", priorInvoiceError.message);
  if (priorInvoices?.length) {
    billingRedirect(
      "error",
      "This school already has an invoice or confirmation for the selected cycle. Void it before issuing a replacement.",
    );
  }

  const scholarshipConfirmation =
    option.amount_cents === 0 && formData.get("scholarship_confirmation") === "on";
  const documentKind = scholarshipConfirmation
    ? "scholarship_confirmation"
    : "invoice";
  const messageTemplates = invoiceMessageTemplates(formData, documentKind);
  const issuedAt = new Date();
  const parsedDue = parseDueDate(dueDate, issuedAt);

  const { data: invoice, error } = await supabase
    .from("school_invoices")
    .insert({
      invoice_number: "",
      cycle_id: application.cycle_id,
      application_id: application.id,
      option_key: option.option_key,
      description_snapshot: option.label,
      amount_cents: option.amount_cents,
      document_kind: documentKind,
      payment_url: option.amount_cents > 0 ? resolvedPaymentUrl : null,
      payment_promo_code: option.promo_code || null,
      recipient_email: recipientEmail,
      billing_name: resolvedBillingName,
      billing_address: resolvedBillingAddress || null,
      billing_contact_name: billingContactName || null,
      billing_contact_phone: billingContactPhone || applicationDetails?.schoolPhone || null,
      school_address_snapshot: applicationDetails?.schoolAddress ?? null,
      school_phone_snapshot: applicationDetails?.schoolPhone ?? null,
      school_type_snapshot: applicationDetails?.schoolType ?? null,
      message_subject_snapshot: messageTemplates.subject,
      message_body_snapshot: messageTemplates.message,
      status: "sent",
      delivery_status: "pending",
      issued_at: issuedAt.toISOString(),
      due_at: option.amount_cents > 0 ? parsedDue.toISOString() : null,
      sent_at: issuedAt.toISOString(),
      next_reminder_at:
        option.amount_cents > 0
          ? new Date(issuedAt.getTime() + 7 * 24 * 60 * 60_000).toISOString()
          : null,
      created_by: owner.id,
    })
    .select("id,document_kind")
    .single();
  if (error || !invoice) billingRedirect("error", error?.message ?? "Invoice could not be created.");

  try {
    await deliverSchoolInvoice(
      invoice.id,
      invoice.document_kind === "scholarship_confirmation"
        ? "scholarship_confirmation"
        : "invoice",
      owner.id,
    );
  } catch (deliveryError) {
    revalidatePath(BILLING_PATH);
    billingRedirect(
      "error",
      `Invoice created, but delivery needs attention: ${deliveryError instanceof Error ? deliveryError.message : "delivery failed"}`,
    );
  }

  revalidateBilling();
  billingRedirect("success", "Invoice sent by email and School Messaging.");
}

export async function bulkCreateAndSendInvoices(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const applicationIds = selectedValues(formData, "application_ids");
  const optionId = text(formData, "option_id");
  const paymentUrl = text(formData, "payment_url");
  const dueDate = text(formData, "due_date");

  if (applicationIds.length === 0 || !optionId) {
    billingRedirect("error", "Choose a pricing option and at least one school.");
  }
  if (applicationIds.length > BULK_LIMIT) {
    billingRedirect("error", `Choose no more than ${BULK_LIMIT} schools at a time.`);
  }

  const supabase = await createClient();
  const [optionResult, applicationResult, memberResult] = await Promise.all([
    supabase
      .from("cycle_invoice_options")
      .select("id,cycle_id,option_key,label,amount_cents,active,payment_url,promo_code")
      .eq("id", optionId)
      .single(),
    supabase
      .from("applications")
      .select("id,cycle_id,school_name,external_applicant_email,form_version_id")
      .in("id", applicationIds)
      .eq("is_archived", false),
    supabase
      .from("application_members")
      .select("application_id,member_role,profiles!application_members_user_id_fkey(email,full_name)")
      .in("application_id", applicationIds)
      .eq("active", true),
  ]);
  if (optionResult.error || !optionResult.data || !optionResult.data.active) {
    billingRedirect("error", optionResult.error?.message ?? "Choose an active pricing option.");
  }
  if (applicationResult.error) billingRedirect("error", applicationResult.error.message);
  if (memberResult.error) billingRedirect("error", memberResult.error.message);

  const option = optionResult.data;
  const resolvedPaymentUrl = paymentUrl || option.payment_url || DEFAULT_INVOICE_PAYMENT_URL;
  if (option.amount_cents > 0 && !validHttpsUrl(resolvedPaymentUrl)) {
    billingRedirect("error", "Paid invoices require a secure https payment link.");
  }

  type MemberRow = {
    application_id: string;
    member_role: string;
    profiles:
      | { email: string | null; full_name: string | null }
      | Array<{ email: string | null; full_name: string | null }>
      | null;
  };
  const contactByApplication = new Map<string, string>();
  const memberRows = (memberResult.data ?? []) as unknown as MemberRow[];
  memberRows
    .sort((left, right) => Number(right.member_role === "primary") - Number(left.member_role === "primary"))
    .forEach((member) => {
      if (contactByApplication.has(member.application_id)) return;
      const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
      if (profile?.email) contactByApplication.set(member.application_id, profile.email.toLowerCase());
    });

  const cycleApplications = (applicationResult.data ?? []).filter(
    (application) => application.cycle_id === option.cycle_id,
  );
  const detailsByApplication = await loadBillingApplicationDetails(
    supabase,
    cycleApplications,
  );
  const { data: existingInvoices, error: existingError } = cycleApplications.length
    ? await supabase
        .from("school_invoices")
        .select("application_id")
        .in("application_id", cycleApplications.map((application) => application.id))
        .eq("cycle_id", option.cycle_id)
        .neq("status", "void")
    : { data: [], error: null };
  if (existingError) billingRedirect("error", existingError.message);

  const alreadyInvoiced = new Set(
    (existingInvoices ?? []).map((invoice) => invoice.application_id),
  );
  const issuedAt = new Date();
  const parsedDue = parseDueDate(dueDate, issuedAt);
  const scholarshipConfirmation =
    option.amount_cents === 0 && formData.get("scholarship_confirmation") === "on";
  const documentKind = scholarshipConfirmation
    ? "scholarship_confirmation"
    : "invoice";
  const messageTemplates = invoiceMessageTemplates(formData, documentKind);
  const rows = cycleApplications.flatMap((application) => {
    const recipientEmail =
      contactByApplication.get(application.id) ??
      application.external_applicant_email?.toLowerCase();
    if (!recipientEmail || alreadyInvoiced.has(application.id)) return [];
    const applicationDetails = detailsByApplication.get(application.id);
    return [{
      invoice_number: "",
      cycle_id: application.cycle_id,
      application_id: application.id,
      option_key: option.option_key,
      description_snapshot: option.label,
      amount_cents: option.amount_cents,
      document_kind: documentKind,
      payment_url: option.amount_cents > 0 ? resolvedPaymentUrl : null,
      payment_promo_code: option.promo_code || null,
      recipient_email: recipientEmail,
      billing_name: application.school_name,
      billing_address: applicationDetails?.schoolAddress ?? null,
      billing_contact_name: null,
      billing_contact_phone: applicationDetails?.schoolPhone ?? null,
      school_address_snapshot: applicationDetails?.schoolAddress ?? null,
      school_phone_snapshot: applicationDetails?.schoolPhone ?? null,
      school_type_snapshot: applicationDetails?.schoolType ?? null,
      message_subject_snapshot: messageTemplates.subject,
      message_body_snapshot: messageTemplates.message,
      status: "sent",
      delivery_status: "pending",
      issued_at: issuedAt.toISOString(),
      due_at: option.amount_cents > 0 ? parsedDue.toISOString() : null,
      sent_at: issuedAt.toISOString(),
      next_reminder_at:
        option.amount_cents > 0
          ? new Date(issuedAt.getTime() + 7 * 24 * 60 * 60_000).toISOString()
          : null,
      created_by: owner.id,
    }];
  });
  if (rows.length === 0) {
    billingRedirect(
      "error",
      "No invoices were created. Check school contacts, cycle selection, or existing open invoices.",
    );
  }

  const { data: invoices, error: insertError } = await supabase
    .from("school_invoices")
    .insert(rows)
    .select("id,document_kind");
  if (insertError || !invoices?.length) {
    billingRedirect("error", insertError?.message ?? "Bulk invoices could not be created.");
  }

  const delivery = await runInBatches(invoices, async (invoice) => {
    await deliverSchoolInvoice(
      invoice.id,
      invoice.document_kind === "scholarship_confirmation"
        ? "scholarship_confirmation"
        : "invoice",
      owner.id,
    );
  });
  revalidateBilling();
  const skipped = applicationIds.length - invoices.length;
  if (delivery.failed > 0) {
    billingRedirect(
      "error",
      `${invoices.length} invoices were created; ${delivery.completed} delivered fully and ${delivery.failed} need delivery attention. ${skipped} selections were skipped.`,
    );
  }
  billingRedirect(
    "success",
    `${delivery.completed} invoices sent. ${skipped > 0 ? `${skipped} selections were skipped because of cycle, contact, or duplicate-invoice checks.` : ""}`.trim(),
  );
}

export async function bulkUpdateInvoices(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const invoiceIds = selectedValues(formData, "invoice_ids");
  const operation = text(formData, "operation");
  if (invoiceIds.length === 0) billingRedirect("error", "Select at least one invoice.");
  if (invoiceIds.length > 100) billingRedirect("error", "Update no more than 100 invoices at a time.");

  const supabase = await createClient();
  const { data: invoices, error } = await supabase
    .from("school_invoices")
    .select("id,status,amount_cents,document_kind,reminder_count")
    .in("id", invoiceIds);
  if (error) billingRedirect("error", error.message);

  if (operation === "mark_paid") {
    const eligibleIds = (invoices ?? [])
      .filter((invoice) => invoice.status === "sent" && invoice.document_kind === "invoice")
      .map((invoice) => invoice.id);
    if (eligibleIds.length === 0) billingRedirect("error", "No selected open invoices can be marked paid.");
    const { data: updated, error: updateError } = await supabase
      .from("school_invoices")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        paid_by: owner.id,
        next_reminder_at: null,
        delivery_status: "pending",
      })
      .in("id", eligibleIds)
      .eq("status", "sent")
      .select("id");
    if (updateError) billingRedirect("error", updateError.message);
    const delivery = await runInBatches(updated ?? [], async (invoice) => {
      await deliverSchoolInvoice(invoice.id, "receipt", owner.id);
    });
    revalidateBilling();
    if (delivery.failed > 0) {
      billingRedirect("error", `${updated?.length ?? 0} invoices were marked paid; ${delivery.failed} receipts need delivery attention.`);
    }
    billingRedirect("success", `${delivery.completed} invoices marked paid and receipts sent.`);
  }

  if (operation === "remind") {
    const eligible = (invoices ?? []).filter(
      (invoice) => invoice.status === "sent" && invoice.amount_cents > 0,
    );
    if (eligible.length === 0) billingRedirect("error", "No selected invoices can receive reminders.");
    const now = new Date();
    const delivery = await runInBatches(eligible, async (invoice) => {
      await deliverSchoolInvoice(invoice.id, "reminder", owner.id);
      const { error: updateError } = await supabase
        .from("school_invoices")
        .update({
          last_reminder_at: now.toISOString(),
          next_reminder_at: new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
          reminder_count: Number(invoice.reminder_count) + 1,
        })
        .eq("id", invoice.id)
        .eq("status", "sent");
      if (updateError) throw new Error(updateError.message);
    });
    revalidateBilling();
    if (delivery.failed > 0) {
      billingRedirect("error", `${delivery.completed} reminders sent; ${delivery.failed} need delivery attention.`);
    }
    billingRedirect("success", `${delivery.completed} payment reminders sent.`);
  }

  if (operation === "resend") {
    const eligible = (invoices ?? []).filter((invoice) => invoice.status !== "void");
    if (eligible.length === 0) {
      billingRedirect("error", "No selected invoices can be resent.");
    }
    const delivery = await runInBatches(eligible, async (invoice) => {
      const deliveryType =
        invoice.status === "paid"
          ? "receipt"
          : invoice.document_kind === "scholarship_confirmation"
            ? "scholarship_confirmation"
            : "invoice";
      await deliverSchoolInvoice(invoice.id, deliveryType, owner.id);
    });
    revalidateBilling();
    if (delivery.failed > 0) {
      billingRedirect(
        "error",
        `${delivery.completed} documents resent; ${delivery.failed} still need delivery attention.`,
      );
    }
    billingRedirect("success", `${delivery.completed} documents resent.`);
  }

  if (operation === "void") {
    const voidReason = text(formData, "void_reason");
    if (voidReason.length < 3) {
      billingRedirect("error", "Enter a reason before voiding invoices.");
    }
    const eligibleIds = (invoices ?? [])
      .filter((invoice) => invoice.status !== "paid" && invoice.status !== "void")
      .map((invoice) => invoice.id);
    if (eligibleIds.length === 0) billingRedirect("error", "No selected invoices can be voided.");
    const { data: updated, error: updateError } = await supabase
      .from("school_invoices")
      .update({
        status: "void",
        next_reminder_at: null,
        reminder_claimed_at: null,
        reminder_claim_token: null,
        voided_at: new Date().toISOString(),
        voided_by: owner.id,
        void_reason: voidReason.slice(0, 500),
      })
      .in("id", eligibleIds)
      .neq("status", "paid")
      .select("id");
    if (updateError) billingRedirect("error", updateError.message);
    revalidateBilling();
    billingRedirect("success", `${updated?.length ?? 0} invoices voided.`);
  }

  billingRedirect("error", "Choose a valid bulk invoice action.");
}

export async function markInvoicePaid(invoiceId: string) {
  const owner = await requireProfile(["owner"]);
  const supabase = await createClient();
  const paidAt = new Date().toISOString();
  const { data: invoice, error } = await supabase
    .from("school_invoices")
    .update({
      status: "paid",
      paid_at: paidAt,
      paid_by: owner.id,
      next_reminder_at: null,
      delivery_status: "pending",
    })
    .eq("id", invoiceId)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();
  if (error || !invoice) {
    billingRedirect("error", error?.message ?? "Only an open invoice can be marked paid.");
  }

  try {
    await deliverSchoolInvoice(invoiceId, "receipt", owner.id);
  } catch (deliveryError) {
    revalidatePath(BILLING_PATH);
    revalidatePath("/portal/invoices");
    billingRedirect(
      "error",
      `Payment recorded, but receipt delivery needs attention: ${deliveryError instanceof Error ? deliveryError.message : "delivery failed"}`,
    );
  }
  revalidatePath(BILLING_PATH);
  revalidatePath("/portal/invoices");
  revalidatePath("/portal/chat");
  billingRedirect("success", "Invoice marked paid and receipt sent.");
}

export async function sendInvoiceReminder(invoiceId: string) {
  const owner = await requireProfile(["owner"]);
  const supabase = await createClient();
  const now = new Date();
  const { data: invoice, error } = await supabase
    .from("school_invoices")
    .select("id,status,amount_cents,reminder_count")
    .eq("id", invoiceId)
    .single();
  if (error || !invoice || invoice.status !== "sent" || invoice.amount_cents < 1) {
    billingRedirect("error", "Only open paid invoices can receive reminders.");
  }

  try {
    await deliverSchoolInvoice(invoiceId, "reminder", owner.id);
  } catch (deliveryError) {
    billingRedirect(
      "error",
      `Reminder delivery needs attention: ${deliveryError instanceof Error ? deliveryError.message : "delivery failed"}`,
    );
  }
  const { error: updateError } = await supabase
    .from("school_invoices")
    .update({
      last_reminder_at: now.toISOString(),
      next_reminder_at: new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
      reminder_count: Number(invoice.reminder_count) + 1,
    })
    .eq("id", invoiceId);
  if (updateError) billingRedirect("error", updateError.message);
  revalidatePath(BILLING_PATH);
  revalidatePath("/portal/chat");
  billingRedirect("success", "Payment reminder sent.");
}

export async function retryInvoiceDelivery(invoiceId: string) {
  const owner = await requireProfile(["owner"]);
  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from("school_invoices")
    .select("id,status,document_kind")
    .eq("id", invoiceId)
    .single();
  if (error || !invoice || invoice.status === "void") {
    billingRedirect("error", "Voided invoices cannot be delivered.");
  }

  const deliveryType =
    invoice.status === "paid"
      ? "receipt"
      : invoice.document_kind === "scholarship_confirmation"
        ? "scholarship_confirmation"
        : "invoice";
  try {
    await deliverSchoolInvoice(invoice.id, deliveryType, owner.id);
  } catch (deliveryError) {
    revalidateBilling();
    billingRedirect(
      "error",
      `Delivery still needs attention: ${deliveryError instanceof Error ? deliveryError.message : "delivery failed"}`,
    );
  }
  revalidateBilling();
  billingRedirect("success", "Invoice document resent by email and School Messaging.");
}

export async function voidInvoice(invoiceId: string, formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const voidReason = text(formData, "void_reason");
  if (voidReason.length < 3) {
    billingRedirect("error", "Enter a reason before voiding an invoice.");
  }
  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from("school_invoices")
    .update({
      status: "void",
      next_reminder_at: null,
      reminder_claimed_at: null,
      reminder_claim_token: null,
      voided_at: new Date().toISOString(),
      voided_by: owner.id,
      void_reason: voidReason.slice(0, 500),
    })
    .eq("id", invoiceId)
    .neq("status", "paid")
    .select("id")
    .maybeSingle();
  if (error || !invoice) {
    billingRedirect("error", error?.message ?? "Paid invoices cannot be voided.");
  }
  revalidatePath(BILLING_PATH);
  revalidatePath("/portal/invoices");
  billingRedirect("success", "Invoice voided.");
}
