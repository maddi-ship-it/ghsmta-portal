import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { sendSmtpEmail } from "@/lib/email/smtp";
import { createInvoicePdf } from "@/lib/reports/invoice-pdf";
import { createAdminClient } from "@/lib/supabase/admin";

import { INVOICE_SCHOOL_CHAT_CHANNEL_TYPE } from "./delivery-routing";
import { resolveInvoiceDeliveryCopy } from "./delivery-copy";
import {
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

  const [
    { data: application },
    { data: cycle },
    { data: members },
    { data: owner },
  ] =
    await Promise.all([
      supabase
        .from("applications")
        .select("school_name,production_title")
        .eq("id", invoice.application_id)
        .single(),
      supabase
        .from("award_cycles")
        .select("name,season_year")
        .eq("id", invoice.cycle_id)
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
  const copy = resolveInvoiceDeliveryCopy(
    invoice as SchoolInvoice,
    schoolName,
    deliveryType,
  );
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

  let emailResult: Awaited<ReturnType<typeof sendSmtpEmail>>;
  try {
    if (!application || !cycle) {
      throw new Error("Invoice PDF context is incomplete.");
    }

    let logoBytes: Uint8Array | undefined;
    try {
      logoBytes = await readFile(
        join(process.cwd(), "public", "artsbridge-foundation-logo.png"),
      );
    } catch {
      logoBytes = undefined;
    }

    const pdfBytes = await createInvoicePdf(
      {
        ...(invoice as SchoolInvoice),
        school_name: application.school_name,
        production_title: application.production_title,
        cycle_name: cycle.name,
        season_year: cycle.season_year,
      },
      logoBytes,
    );
    const attachmentLabel =
      invoice.status === "paid"
        ? "receipt"
        : invoice.document_kind === "scholarship_confirmation"
          ? "scholarship-confirmation"
          : "invoice";
    const emailAction = paymentUrl && deliveryType !== "receipt"
      ? `<p><a href="${escapeHtml(paymentUrl)}" style="display:inline-block;padding:12px 18px;background:#153f8f;color:#fff;text-decoration:none;border-radius:8px">Pay securely</a></p>`
      : "";
    const textAction = paymentUrl && deliveryType !== "receipt"
      ? `\n\nPay securely: ${paymentUrl}`
      : "";

    emailResult = await sendSmtpEmail({
      to: [invoice.recipient_email],
      subject: copy.subject,
      text: `${copy.body}${textAction}\n\nA PDF copy is attached. School team members can also view it in the GHSMTA Portal.`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033"><h2>${escapeHtml(copy.title)}</h2><p>${escapeHtml(copy.body).replaceAll("\n", "<br />")}</p>${emailAction}<p>A PDF copy is attached. School team members can also view it in the GHSMTA Portal.</p></div>`,
      attachments: [
        {
          filename: `${invoice.invoice_number}-${attachmentLabel}.pdf`,
          content: Buffer.from(pdfBytes),
          contentType: "application/pdf",
        },
      ],
    });
  } catch (error) {
    emailResult = {
      ok: false,
      detail: `PDF/email preparation failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }

  let chatStatus = "skipped";
  const { data: channel } = await supabase
    .from("chat_channels")
    .select("id")
    .eq("application_id", invoice.application_id)
    // Financial messages must reach the school-facing conversation. The
    // `school` channel type is the private adjudication Panel Channel.
    .eq("channel_type", INVOICE_SCHOOL_CHAT_CHANNEL_TYPE)
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
  } else {
    chatStatus = "failed: private School Messaging channel not found";
  }

  const failures: string[] = [];
  const memberIds = [...new Set((members ?? []).map((member) => member.user_id))];
  if (memberIds.length > 0) {
    const notificationResult = await supabase.from("user_notifications").insert(
      memberIds.map((userId) => ({
        user_id: userId,
        notification_type: `invoice_${deliveryType}`,
        title: copy.title,
        body: copy.body,
        href: "/portal/invoices",
        related_application_id: invoice.application_id,
      })),
    );
    if (notificationResult.error) {
      failures.push(`notifications: ${notificationResult.error.message}`);
    }
  }

  const emailStatus = emailResult.ok ? "sent" : "failed";
  const delivered = emailResult.ok && chatStatus === "sent";
  const partial = emailResult.ok || chatStatus === "sent";
  const deliveryStatus = delivered ? "delivered" : partial ? "partial" : "failed";
  const deliveredAt = new Date().toISOString();

  const [deliveryLogResult, invoiceStateResult] = await Promise.all([
    supabase.from("invoice_delivery_log").insert({
      invoice_id: invoice.id,
      delivery_type: deliveryType,
      email_status: emailStatus,
      chat_status: chatStatus,
      detail: `Email: ${emailResult.detail}; Chat: ${chatStatus}`,
      delivered_by: requestedBy ?? authorId ?? null,
    }),
    supabase
      .from("school_invoices")
      .update({
        delivery_status: deliveryStatus,
        last_delivery_at: deliveredAt,
      })
      .eq("id", invoice.id),
  ]);

  if (deliveryLogResult.error) {
    failures.push(`delivery audit: ${deliveryLogResult.error.message}`);
  }
  if (invoiceStateResult.error) {
    failures.push(`invoice status: ${invoiceStateResult.error.message}`);
  }
  if (!emailResult.ok) failures.push(`email: ${emailResult.detail}`);
  if (chatStatus !== "sent") failures.push(`chat: ${chatStatus}`);
  if (failures.length > 0) {
    throw new Error(`Delivery incomplete (${failures.join("; ")}).`);
  }

  return { email: emailResult, chatStatus };
}
