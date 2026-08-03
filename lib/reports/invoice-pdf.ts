import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { formatInvoiceAmount, type InvoiceContext } from "../billing/types";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const MAGENTA = rgb(0.82, 0.12, 0.54);
const NAVY = rgb(0.08, 0.16, 0.3);
const MUTED = rgb(0.38, 0.42, 0.5);
const LIGHT = rgb(0.94, 0.95, 0.97);

function wrapText(
  value: string,
  maxWidth: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
) {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function createInvoicePdf(
  invoice: InvoiceContext,
  logoBytes?: Uint8Array,
) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawText("ArtsBridge Foundation", {
    x: MARGIN,
    y: 741,
    size: 11,
    font: bold,
    color: NAVY,
  });
  page.drawText("2800 Cobb Galleria Pkwy\nAtlanta, GA 30339", {
    x: MARGIN,
    y: 724,
    size: 9,
    lineHeight: 13,
    font: regular,
    color: MUTED,
  });

  if (logoBytes) {
    const logo = await pdf.embedPng(logoBytes);
    const scale = Math.min(174 / logo.width, 82 / logo.height);
    page.drawImage(logo, {
      x: PAGE_WIDTH - MARGIN - logo.width * scale,
      y: 694,
      width: logo.width * scale,
      height: logo.height * scale,
    });
  }

  const documentTitle =
    invoice.document_kind === "scholarship_confirmation"
      ? "Scholarship Confirmation"
      : invoice.status === "paid"
        ? "Payment Receipt"
        : "Invoice";
  page.drawText(documentTitle, {
    x: MARGIN,
    y: 650,
    size: 24,
    font: bold,
    color: MAGENTA,
  });
  page.drawText(`${documentTitle}: ${invoice.invoice_number}`, {
    x: MARGIN,
    y: 624,
    size: 11,
    font: bold,
    color: NAVY,
  });
  page.drawText(
    `Date: ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(invoice.issued_at ?? invoice.created_at))}`,
    { x: MARGIN, y: 607, size: 10, font: regular, color: MUTED },
  );

  if (invoice.status === "paid") {
    page.drawRectangle({
      x: 465,
      y: 610,
      width: 99,
      height: 34,
      borderColor: rgb(0.08, 0.55, 0.33),
      borderWidth: 2,
      color: rgb(0.9, 0.98, 0.94),
    });
    page.drawText("PAID", {
      x: 494,
      y: 620,
      size: 15,
      font: bold,
      color: rgb(0.04, 0.43, 0.24),
    });
  }

  page.drawText("Bill To:", {
    x: MARGIN,
    y: 562,
    size: 11,
    font: bold,
    color: NAVY,
  });
  const billTo = [invoice.billing_name, invoice.billing_address, invoice.recipient_email]
    .filter(Boolean)
    .join("\n");
  page.drawText(billTo, {
    x: MARGIN,
    y: 544,
    size: 10,
    lineHeight: 14,
    font: regular,
    color: NAVY,
  });

  const tableTop = 456;
  page.drawRectangle({
    x: MARGIN,
    y: tableTop,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 27,
    color: MAGENTA,
  });
  page.drawText("Description", {
    x: MARGIN + 10,
    y: tableTop + 9,
    size: 10,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText("Amount", {
    x: 502,
    y: tableTop + 9,
    size: 10,
    font: bold,
    color: rgb(1, 1, 1),
  });

  page.drawRectangle({
    x: MARGIN,
    y: 372,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 84,
    borderColor: rgb(0.82, 0.84, 0.88),
    borderWidth: 1,
  });
  page.drawText("Registration Fee", {
    x: MARGIN + 10,
    y: 428,
    size: 11,
    font: bold,
    color: NAVY,
  });
  page.drawText(invoice.description_snapshot, {
    x: MARGIN + 10,
    y: 408,
    size: 9.5,
    font: regular,
    color: NAVY,
  });
  page.drawText(`${invoice.season_year} ${invoice.cycle_name}`, {
    x: MARGIN + 10,
    y: 389,
    size: 9,
    font: regular,
    color: MUTED,
  });
  page.drawText(formatInvoiceAmount(invoice.amount_cents), {
    x: 493,
    y: 426,
    size: 11,
    font: bold,
    color: NAVY,
  });

  page.drawRectangle({
    x: MARGIN,
    y: 166,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 164,
    color: LIGHT,
  });
  page.drawText(
    invoice.document_kind === "scholarship_confirmation"
      ? "Scholarship Information"
      : invoice.status === "paid"
        ? "Receipt Information"
        : "Billing Information",
    { x: MARGIN + 14, y: 305, size: 12, font: bold, color: NAVY },
  );

  const information =
    invoice.document_kind === "scholarship_confirmation"
      ? "This letter confirms a full scholarship. The balance due is $0.00 and no payment action is required."
      : invoice.status === "paid"
        ? `Payment was recorded${invoice.paid_at ? ` on ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(invoice.paid_at))}` : ""}. Please retain this document as your receipt.`
        : invoice.amount_cents === 0
          ? "This is a zero-dollar invoice. The balance due is $0.00 and no payment action is required."
        : `Payment due${invoice.due_at ? ` by ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(invoice.due_at))}` : " upon receipt"}. Use the secure online payment link below.`;
  let y = 282;
  for (const line of wrapText(information, 480, regular, 9.5)) {
    page.drawText(line, { x: MARGIN + 14, y, size: 9.5, font: regular, color: NAVY });
    y -= 14;
  }

  if (invoice.payment_url && invoice.status !== "paid") {
    y -= 4;
    page.drawText("Online payment link:", {
      x: MARGIN + 14,
      y,
      size: 9.5,
      font: bold,
      color: NAVY,
    });
    y -= 16;
    for (const line of wrapText(invoice.payment_url, 480, regular, 9)) {
      page.drawText(line, {
        x: MARGIN + 14,
        y,
        size: 9,
        font: regular,
        color: rgb(0.03, 0.3, 0.7),
      });
      y -= 13;
    }
  }

  page.drawText("Questions? Reply in GHSMTA Chat or contact ArtsBridge Foundation.", {
    x: MARGIN,
    y: 105,
    size: 9,
    font: regular,
    color: MUTED,
  });

  pdf.setTitle(`${documentTitle} ${invoice.invoice_number}`);
  pdf.setAuthor("ArtsBridge Foundation");
  pdf.setSubject(invoice.description_snapshot);
  return pdf.save();
}
