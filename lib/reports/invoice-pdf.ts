import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { formatInvoiceAmount, type InvoiceContext } from "../billing/types";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const MAGENTA = rgb(0.89, 0.2, 0.64);
const NAVY = rgb(0.08, 0.16, 0.3);
const MUTED = rgb(0.38, 0.42, 0.5);
const LIGHT = rgb(0.82, 0.82, 0.82);

function wrapText(
  value: string,
  maxWidth: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
) {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean).flatMap((word) => {
      if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
      const chunks: string[] = [];
      let chunk = "";
      for (const character of word) {
        const candidate = `${chunk}${character}`;
        if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          chunks.push(chunk);
          chunk = character;
        } else {
          chunk = candidate;
        }
      }
      if (chunk) chunks.push(chunk);
      return chunks;
    });
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
    y: 746,
    size: 22,
    font: bold,
    color: NAVY,
  });
  page.drawText("2800 Cobb Galleria Pkwy\nAtlanta, GA 30339", {
    x: MARGIN,
    y: 722,
    size: 12,
    lineHeight: 17,
    font: regular,
    color: MUTED,
  });

  if (logoBytes) {
    const logo = await pdf.embedPng(logoBytes);
    const scale = Math.min(190 / logo.width, 92 / logo.height);
    page.drawImage(logo, {
      x: PAGE_WIDTH - MARGIN - logo.width * scale,
      y: 688,
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
  const issuedDate = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(invoice.issued_at ?? invoice.created_at));
  const titleLabel = documentTitle === "Invoice" ? "Invoice:" : `${documentTitle}:`;
  page.drawText(titleLabel, {
    x: MARGIN,
    y: 650,
    size: documentTitle === "Scholarship Confirmation" ? 17 : 18,
    font: bold,
    color: MAGENTA,
  });
  const titleLabelWidth = bold.widthOfTextAtSize(titleLabel, documentTitle === "Scholarship Confirmation" ? 17 : 18);
  page.drawText(invoice.invoice_number, {
    x: MARGIN + titleLabelWidth + 7,
    y: 650,
    size: 18,
    font: regular,
    color: MAGENTA,
  });
  page.drawText("Date:", { x: MARGIN, y: 625, size: 17, font: bold, color: MAGENTA });
  page.drawText(issuedDate, {
    x: MARGIN + bold.widthOfTextAtSize("Date:", 17) + 7,
    y: 625,
    size: 17,
    font: regular,
    color: MAGENTA,
  });

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
    y: 574,
    size: 11,
    font: bold,
    color: NAVY,
  });
  const billTo = [invoice.billing_name, invoice.billing_address, invoice.recipient_email]
    .filter(Boolean)
    .join("\n");
  page.drawText(billTo, {
    x: MARGIN,
    y: 556,
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
    borderColor: rgb(0.08, 0.08, 0.08),
    borderWidth: 1.5,
  });
  page.drawLine({
    start: { x: 468, y: 372 },
    end: { x: 468, y: tableTop + 27 },
    thickness: 1.5,
    color: rgb(0.08, 0.08, 0.08),
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
    x: 481,
    y: 426,
    size: 11,
    font: bold,
    color: NAVY,
  });

  page.drawRectangle({
    x: MARGIN,
    y: 135,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 195,
    color: LIGHT,
    borderColor: rgb(0.08, 0.08, 0.08),
    borderWidth: 1.5,
  });
  page.drawText(
    invoice.document_kind === "scholarship_confirmation"
      ? "Scholarship Information"
      : invoice.status === "paid"
        ? "Receipt Information"
        : "Billing Information",
    { x: MARGIN + 178, y: 306, size: 14, font: bold, color: rgb(0.08, 0.08, 0.08) },
  );

  page.drawLine({
    start: { x: MARGIN, y: 294 },
    end: { x: PAGE_WIDTH - MARGIN, y: 294 },
    thickness: 1.5,
    color: MAGENTA,
  });

  if (
    invoice.document_kind !== "scholarship_confirmation"
    && invoice.status !== "paid"
    && invoice.amount_cents > 0
  ) {
    const drawBox = (x: number, y: number) => page.drawRectangle({
      x, y, width: 14, height: 14, borderColor: rgb(0.08, 0.08, 0.08), borderWidth: 1.5,
    });
    drawBox(MARGIN + 10, 260);
    page.drawText("Check. Please remit to:", { x: MARGIN + 30, y: 261, size: 11, font: bold, color: NAVY });
    page.drawText("ArtsBridge Foundation", { x: 314, y: 261, size: 11, font: bold, color: NAVY });
    page.drawText("2800 Cobb Galleria Pkwy\nAtlanta, GA 30339", {
      x: 314, y: 243, size: 9.5, lineHeight: 13, font: bold, color: NAVY,
    });

    drawBox(MARGIN + 10, 211);
    page.drawText("Visa/Mastercard/Discover", { x: MARGIN + 30, y: 212, size: 10.5, font: bold, color: NAVY });
    drawBox(MARGIN + 10, 190);
    page.drawText("American Express", { x: MARGIN + 30, y: 191, size: 10.5, font: bold, color: NAVY });
    page.drawText("Credit Card - Use the following\nonline payment link:", {
      x: 314, y: 214, size: 10.5, lineHeight: 14, font: bold, color: NAVY,
    });
    let paymentY = 178;
    for (const line of wrapText(invoice.payment_url ?? "Payment link not provided", 235, regular, 8.2)) {
      page.drawText(line, { x: 314, y: paymentY, size: 8.2, font: regular, color: rgb(0.03, 0.3, 0.7) });
      paymentY -= 11;
    }
  } else {
    const information =
      invoice.document_kind === "scholarship_confirmation"
        ? "This letter confirms a full scholarship. The balance due is $0.00 and no payment action is required."
        : invoice.status === "paid"
          ? `Payment was recorded${invoice.paid_at ? ` on ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(invoice.paid_at))}` : ""}. Please retain this document as your receipt.`
          : "This is a zero-dollar invoice. The balance due is $0.00 and no payment action is required.";
    let informationY = 265;
    for (const line of wrapText(information, 470, regular, 11)) {
      page.drawText(line, { x: MARGIN + 16, y: informationY, size: 11, font: regular, color: NAVY });
      informationY -= 16;
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
