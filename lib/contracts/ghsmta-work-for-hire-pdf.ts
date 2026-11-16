import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";

import type { ContractDocumentData } from "./ghsmta-work-for-hire";

const PAGE = { width: 612, height: 792 };
const MARGIN = 54;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const TOP = PAGE.height - 50;
const BOTTOM = 54;
const BLACK = rgb(0.08, 0.08, 0.08);
const GRAY = rgb(0.35, 0.35, 0.35);
const LINE = rgb(0.55, 0.55, 0.55);
const LIGHT = rgb(0.96, 0.96, 0.96);

type Fonts = {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
};

type RichSegment = {
  text: string;
  font?: PDFFont;
  color?: RGB;
};

const LEGAL_SECTIONS = [
  {
    heading: "NATURE OF WORK and CONSIDERATION:",
    body: "Foundation has engaged Contractor to provide services as set forth in Schedule A. Payment shall be made to the Contractor in accordance with Schedule A. There will be no overtime pay. UNLESS PROVIDED FOR ON SCHEDULE A, CONTRACTOR IS RESPONSIBLE FOR ALL TRANSPORTATION, MEALS, LODGING, INCIDENTAL AND OUT OF POCKET EXPENSES RELATED TO COMPLETING THE SERVICES REQUIRED BY THIS AGREEMENT. SHOULD CONTRACTOR DECIDE TO USE LODGING OTHER THAN WHAT IS EXPLICITLY PROVIDED BY FOUNDATION, CONTRACTOR IS RESPONSIBLE FOR ANY AND ALL COSTS INCURRED AS A RESULT OF THAT ALTERNATIVE LODGING CHOICE. Contractor will receive no additional rights, benefits or payments from the Foundation under this Agreement. Best efforts will be made by Foundation to include contractor's name in the TV credits. Total consideration is based on the aforementioned services notwithstanding existing Foundation commitments. These payments are due for services performed hereunder and verification of completion by the authorized representative of Foundation. If Contractor has multiple agreements with the Foundation, each agreement is exclusive as payment for services cannot overlap.",
  },
  {
    heading: "TERM:",
    body: "",
  },
  {
    heading: "INDEPENDENT CONTRACTOR STATUS:",
    body: "During the term of Contractor's Agreement, Contractor's relationship with Foundation will be that of an independent contractor. Contractor will not represent to any third party that Contractor is an employee of Foundation. Contractor will not participate in any employee benefit program offered now or in the future by Foundation to its employees. In making payments to Contractor of the service fee discussed above, Foundation will not withhold taxes of any kind, including income taxes, FICA, or other statutory withholding or employment taxes applicable to employees. All rights and ownership of materials or products, tangible or intangible, produced under or as a result of this Agreement become the property of the Foundation upon payment of consideration specified herein.",
  },
  {
    heading: "WORK FOR HIRE:",
    body: "The Contractor and Foundation intend this to be a contract for services and each considers the products and results of the services to be rendered by the Contractor hereunder (the \"Work\") to be a work made for hire. The Contractor acknowledges and agrees that the Work (and all rights therein, including, without limitation, copyright) belongs to and shall be the sole and exclusive property of Foundation.",
  },
  {
    heading: "APPROVAL:",
    body: "Foundation retains the right of approval on all releases of information, photographic images, floor plans, production designs, music selections, and any and all other components generated in conjunction with this Agreement. Contractor agrees not to release any information without Foundation's prior approval.",
  },
  {
    heading: "RIGHTS TO MATERIALS:",
    body: "Except for any materials or documents that are property of Foundation and are provided to Contractor for the purpose of the Agreement, all materials developed by Contractor in conjunction with this Agreement shall be the property of Foundation. Contractor shall be granted use of materials developed by Contractor in pursuit of further consulting opportunities, under the condition that appropriate acknowledgement is given to Foundation as owner of such materials. Contractor agrees that at any time, upon notice from Foundation, Contractor will deliver to Foundation, materials, property, or equipment belonging to Foundation.",
  },
  {
    heading: "INDEMNIFICATION:",
    body: "Contractor hereby waives, releases, relinquishes, discharges and agrees to indemnify, protect and save harmless the Foundation, their officers, employees, volunteers, and Cobb-Marietta Coliseum and Exhibit Hall Authority (collectively \"Indemnities\"), of and from any and all claims, demands, liabilities, loss, costs or expenses for any loss or damage for bodily injury (including but not limited to death), personal injury, property damage suffered by Contractor or caused by an act or omission on the part of Contractor, its employees, subcontractors, agents or any other party acting on behalf of Contractor (collectively, the Indemnity Claims\").",
  },
  {
    heading: "PERSONAL PROPERTY:",
    body: "Contractor acknowledges that Foundation may entrust to Contractor various items of personal property in connection with preparation of the Materials. Personal property may include but is not limited to, computers, office and broadcast equipment, and any other property (\"Foundation Property\"). Contractor agrees to return all Foundation's property to Foundation upon Foundation's request or upon the termination of the business relationship between Contractor and Foundation, whichever is earlier. The Contractor agrees to return the Foundation's property in the same condition as it was received.",
  },
  {
    heading: "CONFIDENTIAL MATTER:",
    body: "Any ideas, information, formats, methods, procedures, programs, data, or other matter that may be disclosed by Foundation to Contractor, or which Contractor may learn or observe in the course and scope of preparing the Material are private and confidential, and/or proprietary trade secrets of the Foundation (\"the Confidential Matter\"). The Confidential Matter is made available to Contractor in strict and complete trust and confidence. Contractor shall hold the Confidential Matter in trust and confidence, shall not make any copies of the Confidential Matter, shall not disclose the Confidential Matter to third persons, and shall not use the Confidential Matter at any time except with the prior written permission of the Foundation.",
  },
  {
    heading: "TERMINATION:",
    body: "If this Agreement is terminated for any reason, Foundation shall pay to Contractor any fees due for satisfactory work provided to the Foundation prior to such termination. No other payments will be payable to Contractor upon termination of this Agreement. The satisfactory nature of any work performed by Contractor will be determined solely by the Foundation.",
  },
  {
    heading: "DRUG FREE WORKPLACE:",
    body: "In compliance with the Federal Drug Free Workplace Act of 1988, Contractor hereby certifies that Contractor will not engage in the unlawful manufacture, distribution, possession, or use of a controlled substance in the performance of this Agreement. Contractor shall abide by the terms of this statement as a condition of this Agreement and notify the Foundation of any drug violation occurring in the workplace no later than five days after conviction.",
  },
  {
    heading: "INSURANCE:",
    body: "Any personal vehicle used to transport you to and from any and all locations will be adequately insured by you for collision, liability and property damage in such amounts as are reasonably necessary.",
  },
  {
    heading: "CHOICE OF LAW:",
    body: "Regardless of its place of physical execution or performance, the provisions of this Agreement shall in all respects be construed according to, and the rights and liabilities of the parties hereto shall in all respects be governed by, the laws of Georgia. Contractor hereby submits to the exclusive jurisdiction of the Cobb County, Georgia with regard to any claim, action, or proceeding with respect to this Agreement.",
  },
  {
    heading: "AMENDMENT IN WRITING:",
    body: "It is understood and agreed that no subsequent alteration, amendment, change or addition to this Agreement shall be binding upon the parties herein unless reduced to writing and signed by all parties to this Agreement.",
  },
] as const;

const COMPENSATION_TERMS =
  "Contractor must submit written invoice to Foundation no later than two weeks prior to expected date for receipt of payment. Compensation is dependent on Contractor's successful execution of services as outlined in Schedule A and adherence to the policy in Schedule B. Successful execution of services will be at the Foundation's sole discretion. Foundation reserves the right to withhold or delay payment should Foundation deem in its sole discretion that Contractor has failed to execute services as outlined in the Contract and its addenda. Contractor will receive no additional rights, benefits, or payments from the Foundation under this Agreement.";

const IDEA_PARAGRAPHS = [
  "ArtsBridge Foundation encourages an environment characterized by multiple forms of diversity, such as nationality, appearance, community, gender, sexual orientation, gender identity, disability, age, etc., all of which must be respected and protected. To do so, we ensure an environment of safety, tolerance, respect, non-discrimination, and equality for all students, faculty, crew, contracted individuals, staff members, volunteers, and guests who are involved in any part of an event or program offered by the Foundation. It is our obligation to ensure that each individual can enjoy the benefits that ArtsBridge programs, events, and resources have to offer without experiencing the fear of discrimination, bullying, harassment or demeaning behaviors.",
  "At the same time, it is everyone's obligation to encourage and urge recipients or witnesses of discriminatory behavior to report it immediately to an ArtsBridge staff member, to protect all those under our purview from any adverse consequences of unwanted attitudes, behaviors, and actions.",
  "In such an environment, any manifestation of discriminatory behavior will be identified, recognized, and dealt with in a timely and decisive manner. Any individual or group who knowingly or unknowingly violates any of these policies, and thereby jeopardizes the diverse environment referenced above, may be subject to a cancellation of of contract and heretofore the immediate removal from any and all involvement with programs, activities, rehearsals, and events held under the purview of ArtsBridge Foundation.",
] as const;

function ascii(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function formatLongDate(value: string | null, fallback: string) {
  if (!value) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function formatEventDate(value: string | null) {
  if (!value) return "the date set by the Foundation";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function formatShortDate(value: string | null) {
  if (!value) return "date to be determined";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function fieldLines(value: string | null, fallback: string) {
  const lines = ascii(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines : [fallback];
}

function wrapText(font: PDFFont, value: string, size: number, width: number) {
  const source = ascii(value);
  if (!source) return [""];
  const lines: string[] = [];
  let current = "";
  source.split(/\s+/).forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
      return;
    }
    lines.push(current);
    current = word;
  });
  if (current) lines.push(current);
  return lines;
}

class ContractPdfWriter {
  readonly pages: PDFPage[] = [];
  readonly pdf: PDFDocument;
  readonly fonts: Fonts;
  page!: PDFPage;
  y = TOP;

  constructor(pdf: PDFDocument, fonts: Fonts) {
    this.pdf = pdf;
    this.fonts = fonts;
    this.addPage();
  }

  addPage() {
    this.page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.y = TOP;
  }

  pageBreak() {
    this.addPage();
  }

  ensure(height: number) {
    if (this.y - height < BOTTOM) this.addPage();
  }

  center(value: string, size: number, font = this.fonts.regular, gap = 4) {
    const text = ascii(value);
    this.ensure(size + gap);
    const width = font.widthOfTextAtSize(text, size);
    this.page.drawText(text, {
      x: (PAGE.width - width) / 2,
      y: this.y - size,
      size,
      font,
      color: BLACK,
    });
    this.y -= size + gap;
  }

  paragraph(
    value: string,
    options: { size?: number; lineHeight?: number; gap?: number; indent?: number; font?: PDFFont; color?: RGB } = {},
  ) {
    const size = options.size ?? 9.25;
    const lineHeight = options.lineHeight ?? 11.3;
    const gap = options.gap ?? 6;
    const indent = options.indent ?? 0;
    const font = options.font ?? this.fonts.regular;
    const lines = wrapText(font, value, size, CONTENT_WIDTH - indent * 2);
    lines.forEach((line) => {
      this.ensure(lineHeight);
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y - size,
        size,
        font,
        color: options.color ?? BLACK,
      });
      this.y -= lineHeight;
    });
    this.y -= gap;
  }

  richParagraph(segments: RichSegment[], options: { size?: number; lineHeight?: number; gap?: number; indent?: number } = {}) {
    const size = options.size ?? 8.65;
    const lineHeight = options.lineHeight ?? 10.4;
    const gap = options.gap ?? 5.5;
    const indent = options.indent ?? 0;
    const maxX = PAGE.width - MARGIN - indent;
    let cursorX = MARGIN + indent;

    this.ensure(lineHeight);
    segments.forEach((segment) => {
      const font = segment.font ?? this.fonts.regular;
      const words = ascii(segment.text).split(/\s+/).filter(Boolean);
      words.forEach((word, index) => {
        const token = `${word}${index < words.length - 1 || segment !== segments.at(-1) ? " " : ""}`;
        const width = font.widthOfTextAtSize(token, size);
        if (cursorX > MARGIN + indent && cursorX + width > maxX) {
          this.y -= lineHeight;
          this.ensure(lineHeight);
          cursorX = MARGIN + indent;
        }
        this.page.drawText(token, {
          x: cursorX,
          y: this.y - size,
          size,
          font,
          color: segment.color ?? BLACK,
        });
        cursorX += width;
      });
    });
    this.y -= lineHeight + gap;
  }

  horizontalRule(gap = 10) {
    this.ensure(gap + 2);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE.width - MARGIN, y: this.y },
      thickness: 0.65,
      color: LINE,
    });
    this.y -= gap;
  }

  sectionTitle(value: string) {
    this.center(value, 13, this.fonts.bold, 12);
  }

  signatureBlock(contractorName: string, signerName: string, address: string | null) {
    const needed = 98;
    this.ensure(needed);
    const gap = 24;
    const columnWidth = (CONTENT_WIDTH - gap) / 2;
    const rightX = MARGIN + columnWidth + gap;
    const labelY = this.y - 9;
    this.page.drawText("Contractor", { x: MARGIN, y: labelY, size: 8.5, font: this.fonts.bold, color: BLACK });
    this.page.drawText("ArtsBridge Foundation, Inc.", { x: rightX, y: labelY, size: 8.5, font: this.fonts.bold, color: BLACK });
    const lineY = labelY - 31;
    this.page.drawLine({ start: { x: MARGIN, y: lineY }, end: { x: MARGIN + columnWidth, y: lineY }, thickness: 0.7, color: BLACK });
    this.page.drawLine({ start: { x: rightX, y: lineY }, end: { x: rightX + columnWidth, y: lineY }, thickness: 0.7, color: BLACK });
    this.page.drawText(ascii(contractorName), { x: MARGIN, y: lineY - 12, size: 7.5, font: this.fonts.regular, color: BLACK });
    this.page.drawText("Date", { x: MARGIN + columnWidth - 25, y: lineY - 12, size: 7.5, font: this.fonts.regular, color: BLACK });
    this.page.drawText(ascii(signerName), { x: rightX, y: lineY - 12, size: 7.5, font: this.fonts.regular, color: BLACK });
    this.page.drawText("Date", { x: rightX + columnWidth - 25, y: lineY - 12, size: 7.5, font: this.fonts.regular, color: BLACK });
    this.page.drawText(`Address: ${ascii(address)}`, { x: MARGIN, y: lineY - 29, size: 7.5, font: this.fonts.regular, color: BLACK });
    this.y -= needed;
  }

  tableRow(label: string, paragraphs: string[]) {
    const labelWidth = 152;
    const contentWidth = CONTENT_WIDTH - labelWidth;
    const size = 8.2;
    const lineHeight = 10.1;
    const lines: string[] = [];
    paragraphs.forEach((paragraph, index) => {
      if (index > 0) lines.push("");
      lines.push(...wrapText(this.fonts.regular, paragraph, size, contentWidth - 14));
    });
    if (!lines.length) lines.push("");

    let offset = 0;
    let firstChunk = true;
    while (offset < lines.length) {
      if (this.y - 36 < BOTTOM) this.addPage();
      const available = this.y - BOTTOM - 14;
      const maxLines = Math.max(1, Math.floor(available / lineHeight));
      const chunk = lines.slice(offset, offset + maxLines);
      const rowHeight = Math.max(34, 14 + chunk.length * lineHeight);
      const rowY = this.y - rowHeight;

      this.page.drawRectangle({
        x: MARGIN,
        y: rowY,
        width: CONTENT_WIDTH,
        height: rowHeight,
        borderColor: LINE,
        borderWidth: 0.65,
      });
      this.page.drawRectangle({
        x: MARGIN,
        y: rowY,
        width: labelWidth,
        height: rowHeight,
        color: LIGHT,
      });
      this.page.drawLine({
        start: { x: MARGIN + labelWidth, y: rowY },
        end: { x: MARGIN + labelWidth, y: this.y },
        thickness: 0.65,
        color: LINE,
      });
      const labelText = firstChunk ? label : `${label} (CONTINUED)`;
      wrapText(this.fonts.bold, labelText, 7.2, labelWidth - 12).forEach((line, index) => {
        this.page.drawText(line, {
          x: MARGIN + 7,
          y: this.y - 12 - index * 9,
          size: 7.2,
          font: this.fonts.bold,
          color: BLACK,
        });
      });
      chunk.forEach((line, index) => {
        if (!line) return;
        this.page.drawText(line, {
          x: MARGIN + labelWidth + 7,
          y: this.y - 12 - index * lineHeight,
          size,
          font: this.fonts.regular,
          color: BLACK,
        });
      });
      this.y = rowY;
      offset += chunk.length;
      firstChunk = false;
    }
  }

  finish() {
    this.pages.forEach((page, index) => {
      page.drawLine({
        start: { x: MARGIN, y: 39 },
        end: { x: PAGE.width - MARGIN, y: 39 },
        thickness: 0.4,
        color: LINE,
      });
      const pageLabel = `Page ${index + 1} of ${this.pages.length}`;
      page.drawText(pageLabel, {
        x: PAGE.width - MARGIN - this.fonts.regular.widthOfTextAtSize(pageLabel, 7),
        y: 25,
        size: 7,
        font: this.fonts.regular,
        color: GRAY,
      });
    });
  }
}

export async function buildGhsmtaWorkForHirePdf(contract: ContractDocumentData) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`GHSMTA Contractor Agreement - ${ascii(contract.contractorName)}`);
  pdf.setAuthor("ArtsBridge Foundation, Inc.");
  pdf.setSubject(`Work For Hire agreement for ${ascii(contract.roleTitle)}`);
  pdf.setCreator("GHSMTA Portal");

  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const writer = new ContractPdfWriter(pdf, fonts);
  const agreementDate = formatLongDate(contract.agreementDate, "the date signed below");
  const startsOn = formatLongDate(contract.startsOn, "the date signed below");
  const endsOn = formatLongDate(contract.endsOn, "satisfactory completion of the work");
  const eventDate = formatEventDate(contract.eventDate);
  const signer = contract.foundationSignerName?.trim() || "Foundation Representative";

  writer.center("ARTSBRIDGE FOUNDATION, INC.", 11, fonts.bold, 2);
  writer.center("2800 Cobb Galleria Parkway", 9, fonts.regular, 1);
  writer.center("Atlanta, GA 30339", 9, fonts.regular, 1);
  writer.center("(770) 916-2808", 9, fonts.regular, 14);
  writer.center("CONTRACTOR AGREEMENT", 15, fonts.bold, 2);
  writer.center("Work For Hire", 11, fonts.italic, 15);
  writer.paragraph(
    `This Agreement is made and entered into this ${agreementDate} between the ArtsBridge Foundation, Inc., 2800 Cobb Galleria Parkway, Atlanta, GA 30339 (hereinafter referred to as the \"Foundation\") and ${contract.contractorName} as Georgia High School Musical Theatre Awards (\"GHSMTA\") ${contract.roleTitle}, hereinafter referred to as the \"Contractor\".`,
    { size: 9.2, lineHeight: 11.4, gap: 10 },
  );

  LEGAL_SECTIONS.forEach((section, index) => {
    if (index === 6) writer.pageBreak();
    const body = section.heading === "TERM:"
      ? `The term of this Agreement shall commence on ${startsOn} and end upon the satisfactory completion of the work through the end of business day on ${endsOn} or upon termination of this Agreement as provided in Paragraph 10. Fees will be paid as per the attached Schedule A. Any additional services will be contracted as requested by the Foundation.`
      : section.body;
    writer.richParagraph([
      { text: `${index + 1}. ${section.heading}`, font: fonts.bold },
      { text: body, font: fonts.regular },
    ]);
  });

  writer.y -= 5;
  writer.signatureBlock(contract.contractorName, signer, contract.contractorAddress);

  writer.pageBreak();
  writer.sectionTitle("SCHEDULE A");
  writer.tableRow("CONTRACTOR ROLES / RESPONSIBILITIES:", [
    `Contractor will serve as ${contract.roleTitle} for the Georgia High School Musical Theatre Awards (GHSMTA) scheduled for ${eventDate}. For the duration of this agreement, Contractor agrees to perform faithfully all the services set forth in attached Schedule A, follow the Safety-First Guidelines of the Cobb Energy Performing Arts Centre, located at cobbenergycentre.com, and abide by the I.D.E.A. Policy of the Foundation (see Schedule B).`,
  ]);
  writer.tableRow("SERVICES TO BE PROVIDED BY CONTRACTOR:", [
    `The GHSMTA ${contract.roleTitle} (Contractor) will provide the following services:`,
    ...fieldLines(
      contract.responsibilities,
      `Provide the services customarily associated with the GHSMTA ${contract.roleTitle} role as directed by the Foundation.`,
    ),
  ]);

  const payments = [...contract.payments].sort((left, right) => {
    if (left.due_date && right.due_date) return left.due_date.localeCompare(right.due_date);
    return left.label.localeCompare(right.label);
  });
  const paymentLines = payments.length
    ? payments.map((payment) => {
        const deliverable = ascii(payment.deliverable);
        return `-${money(payment.amount)} on ${formatShortDate(payment.due_date)}${deliverable ? ` upon ${deliverable}` : ""}`;
      })
    : [`-${money(contract.totalConsideration)} according to the invoice schedule approved by the Foundation.`];
  writer.tableRow("COMPENSATION (include amounts, dates, deliverables):", [
    `${money(contract.totalConsideration)} to be paid via the following schedule:`,
    ...paymentLines,
    COMPENSATION_TERMS,
  ]);
  writer.tableRow("TRANSPORTATION:", fieldLines(contract.transportation, "N/A"));
  writer.tableRow("LODGING:", fieldLines(contract.lodging, "N/A"));
  writer.tableRow(
    "MEALS:",
    fieldLines(
      contract.meals,
      "Except for meals provided by ArtsBridge Foundation, Contractor is responsible for all meals.",
    ),
  );
  writer.tableRow("OUT OF POCKET EXPENSES:", fieldLines(contract.outOfPocketExpenses, "N/A"));
  writer.tableRow(
    "COMMUNICATION OF CREDIT:",
    fieldLines(
      contract.communicationCredit,
      `Contractor will be provided the following program credit: GHSMTA ${contract.roleTitle}.`,
    ),
  );

  writer.pageBreak();
  writer.sectionTitle("SCHEDULE B");
  writer.center("I.D.E.A. Policy:", 11, fonts.bold, 2);
  writer.center("(Inclusion, Diversity, Equity, and Access)", 9.5, fonts.italic, 14);
  IDEA_PARAGRAPHS.forEach((paragraph) => writer.paragraph(paragraph, { size: 9.25, lineHeight: 12, gap: 12 }));
  writer.y -= 8;
  writer.signatureBlock(contract.contractorName, signer, contract.contractorAddress);
  writer.ensure(35);
  writer.center("PLEASE PROVIDE A FORM W-9 ALONG WITH THIS AGREEMENT.", 9.5, fonts.bold, 0);

  writer.finish();
  return pdf.save();
}
