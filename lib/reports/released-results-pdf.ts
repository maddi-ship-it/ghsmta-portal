import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import { formatScoreAverage } from "@/lib/adjudication";
import type {
  AdjudicationRelease,
  Application,
  AwardCycle,
} from "@/lib/types";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 44;
const HEADER_HEIGHT = 112;
const FOOTER_HEIGHT = 34;
const CONTENT_TOP = PAGE_HEIGHT - HEADER_HEIGHT - 26;
const CONTENT_BOTTOM = MARGIN + FOOTER_HEIGHT;

const COLORS = {
  midnight: rgb(7 / 255, 11 / 255, 23 / 255),
  navy: rgb(0 / 255, 22 / 255, 153 / 255),
  gold: rgb(212 / 255, 175 / 255, 55 / 255),
  ivory: rgb(247 / 255, 242 / 255, 232 / 255),
  text: rgb(36 / 255, 36 / 255, 36 / 255),
  muted: rgb(96 / 255, 105 / 255, 121 / 255),
  line: rgb(218 / 255, 223 / 255, 233 / 255),
  soft: rgb(246 / 255, 248 / 255, 252 / 255),
  white: rgb(1, 1, 1),
};

type PdfContext = {
  pdf: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  application: Application;
  cycle: AwardCycle | null;
  page: PDFPage;
  y: number;
};

function cleanText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\n]/g, "")
    .trim();
}

function formatDate(value: string | null) {
  if (!value) return "Not released";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function wrapText(
  font: PDFFont,
  value: unknown,
  fontSize: number,
  maxWidth: number,
) {
  const paragraphs = cleanText(value).split(/\n+/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) lines.push(current);
      current = word;

      while (
        current &&
        font.widthOfTextAtSize(current, fontSize) > maxWidth
      ) {
        let splitAt = current.length - 1;
        while (
          splitAt > 1 &&
          font.widthOfTextAtSize(
            `${current.slice(0, splitAt)}-`,
            fontSize,
          ) > maxWidth
        ) {
          splitAt -= 1;
        }
        lines.push(`${current.slice(0, splitAt)}-`);
        current = current.slice(splitAt);
      }
    }

    if (current) lines.push(current);
    lines.push("");
  }

  if (lines.at(-1) === "") lines.pop();
  return lines.length ? lines : ["-"];
}

function drawHeader(
  page: PDFPage,
  bold: PDFFont,
  regular: PDFFont,
  application: Application,
  cycle: AwardCycle | null,
) {
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - HEADER_HEIGHT,
    width: PAGE_WIDTH,
    height: HEADER_HEIGHT,
    color: COLORS.midnight,
  });
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 7,
    width: PAGE_WIDTH,
    height: 7,
    color: COLORS.gold,
  });
  page.drawText("GHSMTA AWARDS PORTAL", {
    x: MARGIN,
    y: PAGE_HEIGHT - 31,
    size: 8.5,
    font: bold,
    color: COLORS.gold,
  });
  page.drawText("Released Adjudication Results", {
    x: MARGIN,
    y: PAGE_HEIGHT - 59,
    size: 21,
    font: bold,
    color: COLORS.white,
  });
  page.drawText(cleanText(application.school_name), {
    x: MARGIN,
    y: PAGE_HEIGHT - 82,
    size: 12,
    font: bold,
    color: COLORS.ivory,
  });
  page.drawText(
    cleanText(application.production_title || "Untitled production"),
    {
      x: MARGIN,
      y: PAGE_HEIGHT - 98,
      size: 9,
      font: regular,
      color: rgb(205 / 255, 216 / 255, 234 / 255),
    },
  );

  const cycleLabel = cycle
    ? `${cycle.season_year} | ${cycle.name}`
    : "GHSMTA application";
  const cycleWidth = regular.widthOfTextAtSize(cleanText(cycleLabel), 8);
  page.drawText(cleanText(cycleLabel), {
    x: PAGE_WIDTH - MARGIN - cycleWidth,
    y: PAGE_HEIGHT - 31,
    size: 8,
    font: regular,
    color: COLORS.ivory,
  });
}

function addPage(context: Omit<PdfContext, "page" | "y">): PdfContext {
  const page = context.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(
    page,
    context.bold,
    context.regular,
    context.application,
    context.cycle,
  );
  return { ...context, page, y: CONTENT_TOP };
}

function ensureSpace(context: PdfContext, required: number) {
  if (context.y - required >= CONTENT_BOTTOM) return context;
  return addPage(context);
}

function drawSectionTitle(context: PdfContext, title: string, subtitle?: string) {
  const next = ensureSpace(context, subtitle ? 50 : 34);
  next.page.drawText(cleanText(title), {
    x: MARGIN,
    y: next.y,
    size: 15,
    font: next.bold,
    color: COLORS.navy,
  });
  next.y -= 8;
  next.page.drawLine({
    start: { x: MARGIN, y: next.y },
    end: { x: PAGE_WIDTH - MARGIN, y: next.y },
    color: COLORS.gold,
    thickness: 1.2,
  });
  next.y -= 16;

  if (subtitle) {
    next.page.drawText(cleanText(subtitle), {
      x: MARGIN,
      y: next.y,
      size: 8.5,
      font: next.regular,
      color: COLORS.muted,
    });
    next.y -= 18;
  }

  return next;
}

function drawParagraph(
  context: PdfContext,
  value: unknown,
  options: {
    font?: PDFFont;
    size?: number;
    color?: ReturnType<typeof rgb>;
    indent?: number;
    lineHeight?: number;
    after?: number;
  } = {},
) {
  const font = options.font ?? context.regular;
  const size = options.size ?? 10;
  const indent = options.indent ?? 0;
  const lineHeight = options.lineHeight ?? size * 1.42;
  const after = options.after ?? 12;
  const maxWidth = PAGE_WIDTH - MARGIN * 2 - indent;
  const lines = wrapText(font, value, size, maxWidth);
  let next = context;

  for (const line of lines) {
    if (!line) {
      next.y -= lineHeight * 0.65;
      continue;
    }
    next = ensureSpace(next, lineHeight + 2);
    next.page.drawText(line, {
      x: MARGIN + indent,
      y: next.y,
      size,
      font,
      color: options.color ?? COLORS.text,
    });
    next.y -= lineHeight;
  }

  next.y -= after;
  return next;
}

function drawScoreRows(context: PdfContext, release: AdjudicationRelease) {
  const scores = Array.isArray(release.score_snapshot)
    ? release.score_snapshot.slice().sort((a, b) => a.sort_order - b.sort_order)
    : [];
  let next = context;

  if (scores.length === 0) {
    return drawParagraph(
      next,
      "No category-average snapshot was included in this release.",
      { color: COLORS.muted },
    );
  }

  for (const [index, item] of scores.entries()) {
    next = ensureSpace(next, 35);
    const rowHeight = 30;
    next.page.drawRectangle({
      x: MARGIN,
      y: next.y - rowHeight + 7,
      width: PAGE_WIDTH - MARGIN * 2,
      height: rowHeight,
      color: index % 2 === 0 ? COLORS.soft : COLORS.white,
      borderColor: COLORS.line,
      borderWidth: 0.5,
    });
    next.page.drawText(cleanText(item.title), {
      x: MARGIN + 10,
      y: next.y - 11,
      size: 9.2,
      font: next.bold,
      color: COLORS.text,
    });
    const value = formatScoreAverage(item.average_score);
    const valueWidth = next.bold.widthOfTextAtSize(cleanText(value), 11);
    next.page.drawText(cleanText(value), {
      x: PAGE_WIDTH - MARGIN - 10 - valueWidth,
      y: next.y - 12,
      size: 11,
      font: next.bold,
      color: COLORS.navy,
    });
    next.y -= rowHeight;
  }

  next.y -= 14;
  return next;
}

function drawFeedback(context: PdfContext, release: AdjudicationRelease) {
  const feedback = Array.isArray(release.feedback_snapshot)
    ? release.feedback_snapshot
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
    : [];
  let next = context;

  if (feedback.length === 0) {
    return drawParagraph(
      next,
      "No panel-feedback snapshot was included in this release.",
      { color: COLORS.muted },
    );
  }

  for (const item of feedback) {
    next = ensureSpace(next, 58);
    next.page.drawRectangle({
      x: MARGIN,
      y: next.y - 24,
      width: PAGE_WIDTH - MARGIN * 2,
      height: 29,
      color: COLORS.navy,
    });
    next.page.drawText(cleanText(item.title), {
      x: MARGIN + 11,
      y: next.y - 13,
      size: 10.5,
      font: next.bold,
      color: COLORS.white,
    });
    next.y -= 38;
    next = drawParagraph(next, item.final_comment, {
      size: 9.6,
      lineHeight: 14,
      indent: 4,
      after: 18,
    });
  }

  return next;
}

function addFooters(pdf: PDFDocument, regular: PDFFont) {
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: FOOTER_HEIGHT },
      end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_HEIGHT },
      color: COLORS.line,
      thickness: 0.6,
    });
    page.drawText("GHSMTA Awards Portal | School-facing released results", {
      x: MARGIN,
      y: 19,
      size: 6.8,
      font: regular,
      color: COLORS.muted,
    });
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    const width = regular.widthOfTextAtSize(pageLabel, 6.8);
    page.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - width,
      y: 19,
      size: 6.8,
      font: regular,
      color: COLORS.muted,
    });
  });
}

export async function buildReleasedResultsPdf({
  application,
  cycle,
  release,
}: {
  application: Application;
  cycle: AwardCycle | null;
  release: AdjudicationRelease;
}) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(
    `GHSMTA Released Results - ${cleanText(application.school_name)}`,
  );
  pdf.setAuthor("GHSMTA Awards Portal");
  pdf.setSubject("School-facing released adjudication results");
  pdf.setCreator("GHSMTA Awards Portal");
  pdf.setProducer("GHSMTA Awards Portal");

  let context = addPage({
    pdf,
    regular,
    bold,
    application,
    cycle,
  });

  context = drawParagraph(
    context,
    "This PDF contains only adjudication information formally released to the school through the GHSMTA Awards Portal.",
    { size: 9.2, color: COLORS.muted, after: 18 },
  );

  if (release.scores_released_at) {
    context = drawSectionTitle(
      context,
      "Released Category Averages",
      `Released ${formatDate(release.scores_released_at)}`,
    );
    context = drawScoreRows(context, release);
  }

  if (release.feedback_released_at) {
    context = drawSectionTitle(
      context,
      "Adjudication Panel Feedback",
      `Released ${formatDate(release.feedback_released_at)}`,
    );
    context = drawFeedback(context, release);
  }

  if (release.release_notes) {
    context = drawSectionTitle(context, "GHSMTA Note");
    drawParagraph(context, release.release_notes, {
      size: 9.8,
      lineHeight: 14,
      after: 10,
    });
  }

  addFooters(pdf, regular);
  return pdf.save();
}
