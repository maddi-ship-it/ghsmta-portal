"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { deliverSchoolInvoice } from "@/lib/billing/delivery";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const BILLING_PATH = "/portal/admin/billing";

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

export async function updateInvoiceOption(optionId: string, formData: FormData) {
  await requireProfile(["owner"]);
  const label = text(formData, "label");
  const amount = text(formData, "amount");
  if (!label) billingRedirect("error", "Enter a pricing option label.");

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
    })
    .eq("id", optionId);
  if (error) billingRedirect("error", error.message);

  revalidatePath(BILLING_PATH);
  billingRedirect("success", "Cycle pricing updated.");
}

export async function createAndSendInvoice(formData: FormData) {
  const owner = await requireProfile(["owner"]);
  const applicationId = text(formData, "application_id");
  const optionId = text(formData, "option_id");
  const recipientEmail = text(formData, "recipient_email").toLowerCase();
  const billingName = text(formData, "billing_name");
  const billingAddress = text(formData, "billing_address");
  const paymentUrl = text(formData, "payment_url");
  const dueDate = text(formData, "due_date");

  if (!applicationId || !optionId || !recipientEmail || !billingName) {
    billingRedirect("error", "Choose a school and price, then add the billing contact.");
  }
  if (!/^\S+@\S+\.\S+$/.test(recipientEmail)) {
    billingRedirect("error", "Enter a valid recipient email.");
  }

  const supabase = await createClient();
  const [{ data: application }, { data: option }] = await Promise.all([
    supabase
      .from("applications")
      .select("id,cycle_id,school_name")
      .eq("id", applicationId)
      .eq("is_archived", false)
      .single(),
    supabase
      .from("cycle_invoice_options")
      .select("id,cycle_id,option_key,label,amount_cents,active")
      .eq("id", optionId)
      .single(),
  ]);
  if (!application || !option || application.cycle_id !== option.cycle_id || !option.active) {
    billingRedirect("error", "That school and pricing option do not belong to the same active cycle.");
  }
  if (option.amount_cents > 0 && !validHttpsUrl(paymentUrl)) {
    billingRedirect("error", "Paid invoices require a secure https payment link.");
  }

  const scholarshipConfirmation =
    option.amount_cents === 0 && formData.get("scholarship_confirmation") === "on";
  const issuedAt = new Date();
  const defaultDue = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60_000);
  const parsedDue = dueDate ? new Date(`${dueDate}T23:59:59`) : defaultDue;
  if (Number.isNaN(parsedDue.getTime())) {
    billingRedirect("error", "Enter a valid due date.");
  }

  const { data: invoice, error } = await supabase
    .from("school_invoices")
    .insert({
      invoice_number: "",
      cycle_id: application.cycle_id,
      application_id: application.id,
      option_key: option.option_key,
      description_snapshot: option.label,
      amount_cents: option.amount_cents,
      document_kind: scholarshipConfirmation ? "scholarship_confirmation" : "invoice",
      payment_url: option.amount_cents > 0 ? paymentUrl : null,
      recipient_email: recipientEmail,
      billing_name: billingName,
      billing_address: billingAddress || null,
      status: "sent",
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

  revalidatePath(BILLING_PATH);
  revalidatePath("/portal/invoices");
  revalidatePath("/portal/chat");
  billingRedirect("success", "Invoice sent by email and School Messaging.");
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

export async function voidInvoice(invoiceId: string) {
  await requireProfile(["owner"]);
  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from("school_invoices")
    .update({ status: "void", next_reminder_at: null })
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
