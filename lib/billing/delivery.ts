import { sendSmtpEmail } from "@/lib/email/smtp";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  formatInvoiceAmount,
  type InvoiceDeliveryType,
  type SchoolInvoice,
} from "./types";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function siteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  ).replace(/\/$/, "");
}

function deliveryCopy(
  invoice: SchoolInvoice,
  schoolName: string,
  deliveryType: InvoiceDeliveryType,
) {
  const amount = formatInvoiceAmount(invoice.amount_cents);
  if (deliveryType === "receipt") {
    return {
      subject: `Payment receipt — ${invoice.invoice_number}`,
      title: "Payment received",
      body: `Thank you. ${schoolName}'s ${amount} payment for ${invoice.description_snapshot} has been marked paid.`,
    };
  }
  if (deliveryType === "reminder") {
    return {
      subject: `Payment reminder — ${invoice.invoice_number}`,
      title: "Payment reminder",
      body: `${schoolName}'s ${amount} invoice for ${invoice.description_snapshot} remains open.`,
    };
  }
  if (deliveryType === "scholarship_confirmation") {
    return {
      subject: `Scholarship confirmation — ${invoice.invoice_number}`,
      title: "Scholarship confirmed",
      body: `${schoolName}'s full scholarship for ${invoice.description_snapshot} is confirmed. No payment is due.`,
    };
  }
  return {
    subject: `GHSMTA invoice ${invoice.invoice_number}`,
    title: "New invoice",
    body: `${schoolName} has a new ${amount} invoice for ${invoice.description_snapshot}.`,
  };
}

export async function deliverSchoolInvoice(
  invoiceId: string,
  deliveryType: InvoiceDeliveryType,
  requestedBy?: string | null,
) {
  const supabase = createAdminClient();
  const { data: invoice, error: invoiceError } = await supabase
    .from("school_invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();
  if (invoiceError || !invoice) {
    throw new Error(invoiceError?.message ?? "Invoice not found.");
  }

  const [{ data: application }, { data: members }, { data: owner }] =
    await Promise.all([
      supabase
        .from("applications")
        .select("school_name,production_title")
        .eq("id", invoice.application_id)
        .single(),
      supabase
        .from("application_members")
        .select("user_id")
        .eq("application_id", invoice.application_id)
        .eq("active", true),
      requestedBy
        ? supabase.from("profiles").select("id").eq("id", requestedBy).maybeSingle()
        : supabase
            .from("profiles")
            .select("id")
            .eq("role", "owner")
            .eq("active", true)
            .limit(1)
            .maybeSingle(),
    ]);

  const schoolName = application?.school_name ?? invoice.billing_name;
  const copy = deliveryCopy(invoice as SchoolInvoice, schoolName, deliveryType);
  const invoiceUrl = `${siteUrl()}/portal/invoices/${invoice.id}/pdf`;
  const paymentUrl = invoice.payment_url as string | null;
  const actionUrl =
    deliveryType === "receipt" || !paymentUrl ? invoiceUrl : paymentUrl;
  const actionLabel =
    deliveryType === "receipt"
      ? "View receipt"
      : paymentUrl
        ? "Pay securely"
        : "View confirmation";

  const emailResult = await sendSmtpEmail({
    to: [invoice.recipient_email],
    subject: copy.subject,
    text: `${copy.body}\n\n${actionLabel}: ${actionUrl}\nInvoice PDF: ${invoiceUrl}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033"><h2>${escapeHtml(copy.title)}</h2><p>${escapeHtml(copy.body)}</p><p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 18px;background:#153f8f;color:#fff;text-decoration:none;border-radius:8px">${escapeHtml(actionLabel)}</a></p><p><a href="${escapeHtml(invoiceUrl)}">View or download the invoice PDF</a></p></div>`,
  });

  let chatStatus = "skipped";
  const { data: channel } = await supabase
    .from("chat_channels")
    .select("id")
    .eq("application_id", invoice.application_id)
    .in("channel_type", ["school_dm", "school"])
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  const authorId = owner?.id ?? requestedBy;
  if (channel && authorId) {
    const chatResult = await supabase.from("chat_posts").insert({
      channel_id: channel.id,
      author_id: authorId,
      subject: copy.title,
      body: `${copy.body}\n\n${actionLabel}: ${actionUrl}\nInvoice PDF: ${invoiceUrl}`,
    });
    chatStatus = chatResult.error ? `failed: ${chatResult.error.message}` : "sent";
  }

  const memberIds = [...new Set((members ?? []).map((member) => member.user_id))];
  if (memberIds.length > 0) {
    await supabase.from("user_notifications").insert(
      memberIds.map((userId) => ({
        user_id: userId,
        notification_type: `invoice_${deliveryType}`,
        title: copy.title,
        body: copy.body,
        href: "/portal/invoices",
        related_application_id: invoice.application_id,
      })),
    );
  }

  await supabase.from("invoice_delivery_log").insert({
    invoice_id: invoice.id,
    delivery_type: deliveryType,
    email_status: emailResult.ok ? "sent" : "failed",
    chat_status: chatStatus,
    detail: emailResult.ok ? emailResult.detail : emailResult.detail,
    delivered_by: requestedBy ?? authorId ?? null,
  });

  const failures: string[] = [];
  if (!emailResult.ok) failures.push(`email: ${emailResult.detail}`);
  if (chatStatus !== "sent") failures.push(`chat: ${chatStatus}`);
  if (failures.length > 0) {
    throw new Error(`Delivery incomplete (${failures.join("; ")}).`);
  }

  return { email: emailResult, chatStatus };
}
