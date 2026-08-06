import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import type { LoadedReport, ReportRow } from "@/lib/reports/report-data";
import type { ReportColumn } from "@/lib/reports/report-definitions";

const LANDSCAPE_WIDTH = 792;
const LANDSCAPE_HEIGHT = 612;
const MARGIN = 30;
const HEADER_HEIGHT = 92;
const FOOTER_HEIGHT = 28;
const TABLE_HEADER_HEIGHT = 24;

const COLORS = {
  navy: rgb(0 / 255, 22 / 255, 153 / 255),
  midnight: rgb(7 / 255, 11 / 255, 23 / 255),
  gold: rgb(212 / 255, 175 / 255, 55 / 255),
  ivory: rgb(247 / 255, 242 / 255, 232 / 255),
  text: rgb(32 / 255, 40 / 255, 56 / 255),
  muted: rgb(94 / 255, 104 / 255, 122 / 255),
  line: rgb(220 / 255, 226 / 255, 236 / 255),
  soft: rgb(247 / 255, 249 / 255, 252 / 255),
  white: rgb(1, 1, 1),
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

function escapeCsvCell(value: unknown) {
  const text = cleanText(value).replace(/\r?\n/g, "\n");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function buildReportCsv(report: LoadedReport) {
  const lines = [
    report.columns.map((column) => escapeCsvCell(column.label)).join(","),
    ...report.rows.map((row) =>
      report.columns.map((column) => escapeCsvCell(row[column.key])).join(","),
    ),
  ];
  return `\uFEFF${lines.join("\n")}`;
}

function textWidth(font: PDFFont, value: string, size: number) {
  return font.widthOfTextAtSize(value, size);
}

function wrapText(
  font: PDFFont,
  value: unknown,
  size: number,
  width: number,
  maxLines = 3,
) {
  const source = cleanText(value) || "-";
  const paragraphs = source.split(/\n+/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (textWidth(font, candidate, size) <= width) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length >= maxLines) break;
  }

  if (lines.length === 0) lines.push("-");
  const joined = lines.join(" ");
  if (joined.length < source.replace(/\s+/g, " ").length) {
    let last = lines[lines.length - 1] ?? "";
    while (last.length > 0 && textWidth(font, `${last}...`, size) > width) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = `${last}...`;
  }
  return lines;
}

function safeFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "report";
}

export function reportFilename(report: LoadedReport, extension: "pdf" | "csv") {
  const date = new Date(report.generatedAt).toISOString().slice(0, 10);
  return `ghsmta-${safeFilename(report.definition.id)}-${date}.${extension}`;
}

function drawHeader(
  page: PDFPage,
  report: LoadedReport,
  fonts: { regular: PDFFont; bold: PDFFont; serif: PDFFont },
) {
  page.drawRectangle({
    x: 0,
    y: LANDSCAPE_HEIGHT - HEADER_HEIGHT,
    width: LANDSCAPE_WIDTH,
    height: HEADER_HEIGHT,
    color: COLORS.midnight,
  });
  page.drawRectangle({
    x: 0,
    y: LANDSCAPE_HEIGHT - 7,
    width: LANDSCAPE_WIDTH,
    height: 7,
    color: COLORS.gold,
  });
  page.drawText("GHSMTA AWARDS PORTAL", {
    x: MARGIN,
    y: LANDSCAPE_HEIGHT - 30,
    size: 9,
    font: fonts.bold,
    color: COLORS.gold,
  });
  page.drawText(cleanText(report.definition.title), {
    x: MARGIN,
    y: LANDSCAPE_HEIGHT - 58,
    size: 22,
    font: fonts.serif,
    color: COLORS.white,
  });
  page.drawText(
    `${report.filters.variant === "external" ? "External" : "Internal"} · ${report.rows.length} rows · Generated ${new Date(report.generatedAt).toLocaleString("en-US")}`,
    {
      x: MARGIN,
      y: LANDSCAPE_HEIGHT - 78,
      size: 9,
      font: fonts.regular,
      color: COLORS.ivory,
    },
  );
}

function drawFooter(
  page: PDFPage,
  pageNumber: number,
  totalPages: number,
  fonts: { regular: PDFFont },
) {
  page.drawLine({
    start: { x: MARGIN, y: FOOTER_HEIGHT + 3 },
    end: { x: LANDSCAPE_WIDTH - MARGIN, y: FOOTER_HEIGHT + 3 },
    thickness: 0.7,
    color: COLORS.line,
  });
  page.drawText("Internal GHSMTA report. Respect release, score, and contact visibility settings.", {
    x: MARGIN,
    y: 16,
    size: 7,
    font: fonts.regular,
    color: COLORS.muted,
  });
  page.drawText(`Page ${pageNumber} of ${totalPages}`, {
    x: LANDSCAPE_WIDTH - MARGIN - 60,
    y: 16,
    size: 7,
    font: fonts.regular,
    color: COLORS.muted,
  });
}

function columnWidths(columns: ReportColumn[]) {
  const available = LANDSCAPE_WIDTH - MARGIN * 2;
  const minWidth = 58;
  const natural = columns.map((column) => Math.max(minWidth, Math.min(150, column.label.length * 7)));
  const total = natural.reduce((sum, width) => sum + width, 0);
  return natural.map((width) => (width / total) * available);
}

function drawTableHeader(
  page: PDFPage,
  columns: ReportColumn[],
  widths: number[],
  fonts: { bold: PDFFont },
  y: number,
) {
  page.drawRectangle({
    x: MARGIN,
    y: y - TABLE_HEADER_HEIGHT + 4,
    width: LANDSCAPE_WIDTH - MARGIN * 2,
    height: TABLE_HEADER_HEIGHT,
    color: COLORS.navy,
  });
  let x = MARGIN + 5;
  columns.forEach((column, index) => {
    page.drawText(cleanText(column.label).slice(0, 28), {
      x,
      y: y - 11,
      size: 7,
      font: fonts.bold,
      color: COLORS.white,
    });
    x += widths[index];
  });
}

function drawRow(
  page: PDFPage,
  row: ReportRow,
  columns: ReportColumn[],
  widths: number[],
  fonts: { regular: PDFFont },
  y: number,
  height: number,
  shaded: boolean,
) {
  if (shaded) {
    page.drawRectangle({
      x: MARGIN,
      y: y - height + 3,
      width: LANDSCAPE_WIDTH - MARGIN * 2,
      height,
      color: COLORS.soft,
    });
  }

  let x = MARGIN + 5;
  columns.forEach((column, index) => {
    const width = widths[index] - 8;
    const lines = wrapText(fonts.regular, row[column.key], 6.7, width, 3);
    lines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x,
        y: y - 10 - lineIndex * 8,
        size: 6.7,
        font: fonts.regular,
        color: COLORS.text,
      });
    });
    x += widths[index];
  });
  page.drawLine({
    start: { x: MARGIN, y: y - height + 3 },
    end: { x: LANDSCAPE_WIDTH - MARGIN, y: y - height + 3 },
    thickness: 0.4,
    color: COLORS.line,
  });
}

function rowsForPdf(report: LoadedReport) {
  const maxColumns = 10;
  const columns = report.columns.slice(0, maxColumns);
  const rows = report.rows.slice(0, 1000);
  const warnings = [...report.warnings];
  if (report.columns.length > maxColumns) {
    warnings.push(`PDF preview includes the first ${maxColumns} columns. Download CSV for all fields.`);
  }
  if (report.rows.length > rows.length) {
    warnings.push(`PDF preview includes the first ${rows.length} rows. Download CSV for the complete export.`);
  }
  return { columns, rows, warnings };
}

export async function buildReportPdf(report: LoadedReport) {
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    serif: await pdf.embedFont(StandardFonts.TimesRomanBold),
  };
  const { columns, rows, warnings } = rowsForPdf(report);
  const widths = columnWidths(columns);
  const pages: PDFPage[] = [];

  const addPage = () => {
    const page = pdf.addPage([LANDSCAPE_WIDTH, LANDSCAPE_HEIGHT]);
    pages.push(page);
    drawHeader(page, report, fonts);
    drawTableHeader(page, columns, widths, fonts, LANDSCAPE_HEIGHT - HEADER_HEIGHT - 16);
    return {
      page,
      y: LANDSCAPE_HEIGHT - HEADER_HEIGHT - TABLE_HEADER_HEIGHT - 18,
    };
  };

  let { page, y } = addPage();
  const rowHeight = 32;

  if (warnings.length > 0) {
    const warningText = warnings.join("  ");
    page.drawRectangle({
      x: MARGIN,
      y: y - 37,
      width: LANDSCAPE_WIDTH - MARGIN * 2,
      height: 30,
      color: COLORS.ivory,
      borderColor: COLORS.gold,
      borderWidth: 0.7,
    });
    wrapText(fonts.regular, warningText, 8, LANDSCAPE_WIDTH - MARGIN * 2 - 16, 2).forEach((line, index) => {
      page.drawText(line, {
        x: MARGIN + 8,
        y: y - 18 - index * 9,
        size: 8,
        font: fonts.regular,
        color: COLORS.text,
      });
    });
    y -= 42;
  }

  if (rows.length === 0) {
    page.drawText("No rows matched the selected filters.", {
      x: MARGIN,
      y: y - 10,
      size: 11,
      font: fonts.bold,
      color: COLORS.text,
    });
  } else {
    rows.forEach((row, index) => {
      if (y - rowHeight < FOOTER_HEIGHT + 12) {
        ({ page, y } = addPage());
      }
      drawRow(page, row, columns, widths, fonts, y, rowHeight, index % 2 === 1);
      y -= rowHeight;
    });
  }

  pages.forEach((pdfPage, index) => {
    drawFooter(pdfPage, index + 1, pages.length, fonts);
  });

  return pdf.save();
}
