import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import type { LoadedReport, ReportRow } from "@/lib/reports/report-data";

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN = 24;
const HEADER_HEIGHT = 88;
const MONTH_HEIGHT = 28;
const FOOTER_HEIGHT = 25;
const CARD_GAP = 8;
const CARDS_PER_PAGE = 6;
const CARD_COLUMNS = 3;
const CARD_ROWS = 2;

const COLORS = {
  midnight: rgb(7 / 255, 11 / 255, 23 / 255),
  navy: rgb(0 / 255, 22 / 255, 153 / 255),
  gold: rgb(212 / 255, 175 / 255, 55 / 255),
  ivory: rgb(247 / 255, 242 / 255, 232 / 255),
  text: rgb(32 / 255, 40 / 255, 56 / 255),
  muted: rgb(94 / 255, 104 / 255, 122 / 255),
  line: rgb(218 / 255, 223 / 255, 233 / 255),
  soft: rgb(247 / 255, 249 / 255, 252 / 255),
  open: rgb(255 / 255, 248 / 255, 218 / 255),
  white: rgb(1, 1, 1),
};

const MONTH_ACCENTS = [
  rgb(45 / 255, 85 / 255, 160 / 255),
  rgb(25 / 255, 123 / 255, 113 / 255),
  rgb(98 / 255, 80 / 255, 147 / 255),
  rgb(181 / 255, 76 / 255, 82 / 255),
  rgb(180 / 255, 110 / 255, 28 / 255),
  rgb(69 / 255, 112 / 255, 166 / 255),
  rgb(125 / 255, 84 / 255, 151 / 255),
  rgb(40 / 255, 130 / 255, 141 / 255),
  rgb(177 / 255, 84 / 255, 130 / 255),
  rgb(93 / 255, 118 / 255, 52 / 255),
  rgb(167 / 255, 80 / 255, 42 / 255),
  rgb(47 / 255, 92 / 255, 146 / 255),
];

type ScheduleItem = {
  row: ReportRow;
  startsAt: Date;
  monthKey: string;
  monthLabel: string;
};

type Fonts = {
  regular: PDFFont;
  bold: PDFFont;
  oblique: PDFFont;
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

function truncate(font: PDFFont, value: unknown, size: number, width: number) {
  const source = cleanText(value) || "Open";
  if (font.widthOfTextAtSize(source, size) <= width) return source;
  let result = source;
  while (
    result.length > 1 &&
    font.widthOfTextAtSize(`${result}...`, size) > width
  ) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

function splitNames(value: unknown) {
  return cleanText(value)
    .split(/\s*;\s*/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function dateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return { year, month };
}

function scheduleItems(rows: ReportRow[]) {
  return rows
    .filter((row) => cleanText(row.school))
    .flatMap((row): ScheduleItem[] => {
      const startsAt = new Date(cleanText(row.starts_at));
      if (!Number.isFinite(startsAt.getTime())) return [];
      const { year, month } = dateParts(startsAt);
      return [
        {
          row,
          startsAt,
          monthKey: `${year}-${month}`,
          monthLabel: new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            month: "long",
            year: "numeric",
          }).format(startsAt),
        },
      ];
    })
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function formatCardDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date).toUpperCase();
}

function formatCardTime(start: Date, endValue: unknown) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
  const end = new Date(cleanText(endValue));
  if (!Number.isFinite(end.getTime())) return formatter.format(start);
  return `${formatter.format(start)}-${formatter.format(end)}`;
}

function drawHeader({
  page,
  logo,
  fonts,
  report,
}: {
  page: PDFPage;
  logo: PDFImage;
  fonts: Fonts;
  report: LoadedReport;
}) {
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - HEADER_HEIGHT,
    width: PAGE_WIDTH,
    height: HEADER_HEIGHT,
    color: COLORS.midnight,
  });
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 6,
    width: PAGE_WIDTH,
    height: 6,
    color: COLORS.gold,
  });
  page.drawLine({
    start: { x: 108, y: PAGE_HEIGHT - HEADER_HEIGHT + 10 },
    end: { x: 108, y: PAGE_HEIGHT - 18 },
    color: COLORS.gold,
    thickness: 1.1,
  });

  const logoHeight = HEADER_HEIGHT - 18;
  const logoWidth = logoHeight * (logo.width / logo.height);
  page.drawImage(logo, {
    x: 18,
    y:
      PAGE_HEIGHT - HEADER_HEIGHT +
      (HEADER_HEIGHT - 6 - logoHeight) / 2,
    width: logoWidth,
    height: logoHeight,
  });
  page.drawText("GHSMTA AWARDS PORTAL", {
    x: 126,
    y: PAGE_HEIGHT - 24,
    size: 7.7,
    font: fonts.bold,
    color: COLORS.gold,
  });
  page.drawText("Monthly Adjudication Schedule", {
    x: 126,
    y: PAGE_HEIGHT - 50,
    size: 19.5,
    font: fonts.bold,
    color: COLORS.white,
  });
  const cycle = cleanText(report.rows.find((row) => cleanText(row.cycle))?.cycle);
  const generated = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(report.generatedAt));
  page.drawText([cycle, `Generated ${generated}`].filter(Boolean).join("  |  "), {
    x: 126,
    y: PAGE_HEIGHT - 68,
    size: 7.5,
    font: fonts.regular,
    color: COLORS.ivory,
  });
}

function drawMonthBanner({
  page,
  fonts,
  label,
  accent,
  continued,
  count,
}: {
  page: PDFPage;
  fonts: Fonts;
  label: string;
  accent: ReturnType<typeof rgb>;
  continued: boolean;
  count: number;
}) {
  const y = PAGE_HEIGHT - HEADER_HEIGHT - MONTH_HEIGHT;
  page.drawRectangle({
    x: 0,
    y,
    width: PAGE_WIDTH,
    height: MONTH_HEIGHT,
    color: COLORS.white,
  });
  page.drawRectangle({
    x: MARGIN,
    y: y + 5,
    width: 5,
    height: MONTH_HEIGHT - 10,
    color: accent,
  });
  page.drawText(`${label.toUpperCase()}${continued ? " - CONTINUED" : ""}`, {
    x: MARGIN + 13,
    y: y + 9,
    size: 11,
    font: fonts.bold,
    color: COLORS.text,
  });
  const countLabel = `${count} adjudication${count === 1 ? "" : "s"}`;
  const countWidth = fonts.regular.widthOfTextAtSize(countLabel, 7.5);
  page.drawText(countLabel, {
    x: PAGE_WIDTH - MARGIN - countWidth,
    y: y + 10,
    size: 7.5,
    font: fonts.regular,
    color: COLORS.muted,
  });
}

function drawStaffRow({
  page,
  fonts,
  x,
  y,
  width,
  label,
  value,
  alternate,
}: {
  page: PDFPage;
  fonts: Fonts;
  x: number;
  y: number;
  width: number;
  label: string;
  value: string;
  alternate: boolean;
}) {
  const rowHeight = 10.2;
  if (alternate) {
    page.drawRectangle({
      x,
      y: y - 2.1,
      width,
      height: rowHeight,
      color: COLORS.soft,
    });
  }
  const hasValue = Boolean(value);
  if (!hasValue) {
    page.drawRectangle({
      x: x + 61,
      y: y - 2.1,
      width: width - 61,
      height: rowHeight,
      color: COLORS.open,
    });
  }
  page.drawText(label, {
    x: x + 5,
    y,
    size: 5.5,
    font: fonts.bold,
    color: COLORS.muted,
  });
  page.drawText(
    truncate(fonts.regular, hasValue ? value : "Open", 6.2, width - 70),
    {
      x: x + 65,
      y: y - 0.2,
      size: 6.2,
      font: fonts.regular,
      color: hasValue ? COLORS.text : COLORS.muted,
    },
  );
}

function drawChecklistItem({
  page,
  fonts,
  x,
  y,
  label,
  checked,
}: {
  page: PDFPage;
  fonts: Fonts;
  x: number;
  y: number;
  label: string;
  checked: boolean;
}) {
  page.drawRectangle({
    x,
    y: y - 0.5,
    width: 6,
    height: 6,
    borderColor: checked ? COLORS.navy : COLORS.muted,
    borderWidth: 0.7,
    color: checked ? COLORS.navy : COLORS.white,
  });
  if (checked) {
    page.drawText("X", {
      x: x + 1.1,
      y: y + 0.2,
      size: 4.8,
      font: fonts.bold,
      color: COLORS.white,
    });
  }
  page.drawText(label, {
    x: x + 9,
    y,
    size: 5.3,
    font: fonts.regular,
    color: COLORS.text,
  });
}

function drawScheduleCard({
  page,
  fonts,
  item,
  x,
  y,
  width,
  height,
  accent,
}: {
  page: PDFPage;
  fonts: Fonts;
  item: ScheduleItem;
  x: number;
  y: number;
  width: number;
  height: number;
  accent: ReturnType<typeof rgb>;
}) {
  const { row, startsAt } = item;
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: COLORS.white,
    borderColor: COLORS.line,
    borderWidth: 0.8,
  });
  page.drawRectangle({
    x,
    y: y + height - 20,
    width,
    height: 20,
    color: accent,
  });
  page.drawText(formatCardDate(startsAt), {
    x: x + 6,
    y: y + height - 13,
    size: 7,
    font: fonts.bold,
    color: COLORS.white,
  });
  const timeLabel = formatCardTime(startsAt, row.ends_at);
  const timeWidth = fonts.bold.widthOfTextAtSize(timeLabel, 6.6);
  page.drawText(timeLabel, {
    x: x + width - timeWidth - 6,
    y: y + height - 13,
    size: 6.6,
    font: fonts.bold,
    color: COLORS.white,
  });

  page.drawText(truncate(fonts.bold, row.school, 7.7, width - 12), {
    x: x + 6,
    y: y + height - 33,
    size: 7.7,
    font: fonts.bold,
    color: COLORS.text,
  });
  const city = cleanText(row.city);
  const venue = cleanText(row.venue);
  const location = city && city !== "City not provided" ? `${city}, GA` : venue;
  page.drawText(truncate(fonts.regular, location || "Location pending", 6.4, width - 12), {
    x: x + 6,
    y: y + height - 44,
    size: 6.4,
    font: fonts.regular,
    color: COLORS.muted,
  });
  page.drawText(truncate(fonts.oblique, row.production || "Production pending", 6.4, width - 12), {
    x: x + 6,
    y: y + height - 55,
    size: 6.4,
    font: fonts.oblique,
    color: COLORS.text,
  });
  page.drawLine({
    start: { x: x + 5, y: y + height - 60 },
    end: { x: x + width - 5, y: y + height - 60 },
    thickness: 0.5,
    color: COLORS.line,
  });

  const adjudicators = splitNames(row.assigned_adjudicators);
  const understudies = splitNames(row.understudies);
  const shadows = splitNames(row.shadows);
  const staffRows = [
    ["ADVISORY", splitNames(row.advisory_member)[0] ?? ""],
    ["ADJUDICATOR 1", adjudicators[0] ?? ""],
    ["ADJUDICATOR 2", adjudicators[1] ?? ""],
    ["ADJUDICATOR 3", adjudicators[2] ?? ""],
    ["UNDERSTUDY", understudies[0] ?? ""],
    ["SHADOW 1", shadows[0] ?? ""],
    ["SHADOW 2", shadows[1] ?? ""],
    ["SHADOW 3", shadows[2] ?? ""],
  ];
  let staffY = y + height - 70;
  staffRows.forEach(([label, value], index) => {
    drawStaffRow({
      page,
      fonts,
      x,
      y: staffY,
      width,
      label,
      value,
      alternate: index % 2 === 1,
    });
    staffY -= 10.2;
  });

  const checklistTop = y + height - 157;
  page.drawLine({
    start: { x: x + 5, y: checklistTop + 8 },
    end: { x: x + width - 5, y: checklistTop + 8 },
    thickness: 0.5,
    color: COLORS.line,
  });
  page.drawText("OWNER TRACKING", {
    x: x + 6,
    y: checklistTop - 1,
    size: 5.4,
    font: fonts.bold,
    color: COLORS.muted,
  });
  const checklistColumnWidth = (width - 12) / 2;
  [
    ["Pick 6 Sent", Boolean(row.pick_six_sent)],
    ["Moved to Section C", Boolean(row.moved_to_section_c)],
    ["Section C Complete", Boolean(row.section_c_complete)],
    ["Final Comments/scores released", Boolean(row.final_results_released)],
  ].forEach(([label, checked], index) => {
    const column = index % 2;
    const checklistRow = Math.floor(index / 2);
    drawChecklistItem({
      page,
      fonts,
      x: x + 6 + column * checklistColumnWidth,
      y: checklistTop - 14 - checklistRow * 13,
      label: String(label),
      checked: Boolean(checked),
    });
  });
}

function drawFooter(
  page: PDFPage,
  fonts: Fonts,
  pageNumber: number,
  totalPages: number,
) {
  page.drawLine({
    start: { x: MARGIN, y: FOOTER_HEIGHT },
    end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_HEIGHT },
    color: COLORS.line,
    thickness: 0.6,
  });
  page.drawText("GHSMTA Awards Portal | Internal monthly adjudication schedule", {
    x: MARGIN,
    y: 14,
    size: 6.5,
    font: fonts.regular,
    color: COLORS.muted,
  });
  const pageLabel = `Page ${pageNumber} of ${totalPages}`;
  const width = fonts.regular.widthOfTextAtSize(pageLabel, 6.5);
  page.drawText(pageLabel, {
    x: PAGE_WIDTH - MARGIN - width,
    y: 14,
    size: 6.5,
    font: fonts.regular,
    color: COLORS.muted,
  });
}

export async function buildScheduleCalendarPdf(report: LoadedReport) {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    oblique: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const logo = await pdf.embedPng(
    await readFile(path.join(process.cwd(), "public", "ghsmta-logo-pdf.png")),
  );
  const items = scheduleItems(report.rows);
  const monthGroups = new Map<string, ScheduleItem[]>();
  for (const item of items) {
    const group = monthGroups.get(item.monthKey) ?? [];
    group.push(item);
    monthGroups.set(item.monthKey, group);
  }

  const sections = [...monthGroups.values()].flatMap((monthItems) =>
    chunk(monthItems, CARDS_PER_PAGE).map((pageItems, index) => ({
      items: pageItems,
      monthCount: monthItems.length,
      monthLabel: monthItems[0]?.monthLabel ?? "Schedule",
      monthIndex: Math.max(0, Number(monthItems[0]?.monthKey.slice(5, 7) ?? 1) - 1),
      continued: index > 0,
    })),
  );

  if (sections.length === 0) {
    sections.push({
      items: [],
      monthCount: 0,
      monthLabel: "Schedule",
      monthIndex: 0,
      continued: false,
    });
  }

  pdf.setTitle("GHSMTA Monthly Adjudication Schedule");
  pdf.setAuthor("GHSMTA Awards Portal");
  pdf.setSubject("Internal monthly adjudication schedule and staffing assignments");
  pdf.setCreator("GHSMTA Awards Portal");
  pdf.setProducer("GHSMTA Awards Portal");

  const pages = sections.map((section) => {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const accent = MONTH_ACCENTS[section.monthIndex] ?? COLORS.navy;
    drawHeader({ page, logo, fonts, report });
    drawMonthBanner({
      page,
      fonts,
      label: section.monthLabel,
      accent,
      continued: section.continued,
      count: section.monthCount,
    });

    if (section.items.length === 0) {
      page.drawText("No booked adjudications matched the selected report filters.", {
        x: MARGIN,
        y: PAGE_HEIGHT - HEADER_HEIGHT - MONTH_HEIGHT - 38,
        size: 11,
        font: fonts.bold,
        color: COLORS.text,
      });
      return page;
    }

    const contentTop = PAGE_HEIGHT - HEADER_HEIGHT - MONTH_HEIGHT - 8;
    const contentBottom = FOOTER_HEIGHT + 8;
    const cardWidth =
      (PAGE_WIDTH - MARGIN * 2 - CARD_GAP * (CARD_COLUMNS - 1)) /
      CARD_COLUMNS;
    const cardHeight =
      (contentTop - contentBottom - CARD_GAP * (CARD_ROWS - 1)) / CARD_ROWS;
    section.items.forEach((item, index) => {
      const column = index % CARD_COLUMNS;
      const row = Math.floor(index / CARD_COLUMNS);
      drawScheduleCard({
        page,
        fonts,
        item,
        x: MARGIN + column * (cardWidth + CARD_GAP),
        y: contentTop - (row + 1) * cardHeight - row * CARD_GAP,
        width: cardWidth,
        height: cardHeight,
        accent,
      });
    });
    return page;
  });

  pages.forEach((page, index) => {
    drawFooter(page, fonts, index + 1, pages.length);
  });

  return pdf.save();
}
