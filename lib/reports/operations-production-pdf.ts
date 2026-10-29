import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  PDFDocument,
  StandardFonts,
  type PDFImage,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import type { LoadedReport, ReportRow } from "@/lib/reports/report-data";
import { GHSMTA_PRINT } from "@/lib/reports/print-brand";

const PORTRAIT = { width: 612, height: 792 };
const LANDSCAPE = { width: 792, height: 612 };
const MARGIN = 36;
const COLORS = {
  navy: GHSMTA_PRINT.navy,
  navy2: GHSMTA_PRINT.navySoft,
  gold: GHSMTA_PRINT.gold,
  goldSoft: GHSMTA_PRINT.goldSoft,
  ivory: GHSMTA_PRINT.ivory,
  ink: GHSMTA_PRINT.ink,
  muted: GHSMTA_PRINT.muted,
  line: GHSMTA_PRINT.line,
  row: GHSMTA_PRINT.row,
  white: GHSMTA_PRINT.white,
};

type Fonts = { regular: PDFFont; bold: PDFFont; serif: PDFFont };
type TableColumn = { key: string; label: string; width: number; align?: "left" | "right" | "center" };
type PageState = { page: PDFPage; y: number; number: number };

function clean(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function fitText(font: PDFFont, value: unknown, size: number, width: number) {
  const source = clean(value) || "-";
  if (font.widthOfTextAtSize(source, size) <= width) return source;
  let text = source;
  while (text.length > 1 && font.widthOfTextAtSize(`${text}...`, size) > width) text = text.slice(0, -1);
  return `${text}...`;
}

function wrapText(font: PDFFont, value: unknown, size: number, width: number, maxLines = 3) {
  const source = clean(value) || "-";
  const lines: string[] = [];
  let current = "";
  source.split(/\s+/).forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) current = candidate;
    else {
      if (current && lines.length < maxLines) lines.push(current);
      current = word;
    }
  });
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.join(" ").length < source.length && lines.length) lines[lines.length - 1] = fitText(font, `${lines[lines.length - 1]}...`, size, width);
  return lines.length ? lines : ["-"];
}

function rowText(row: ReportRow, key: string) {
  return clean(row[key]);
}

function drawContainedImage(page: PDFPage, image: PDFImage, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  page.drawImage(image, { x: x + (width - drawWidth) / 2, y: y + (height - drawHeight) / 2, width: drawWidth, height: drawHeight });
}

async function loadLogo(pdf: PDFDocument) {
  try {
    const bytes = await readFile(path.join(process.cwd(), "public", "ghsmta-logo-pdf.png"));
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

function drawHeader(page: PDFPage, fonts: Fonts, logo: PDFImage | null, title: string, subtitle: string, continued = false) {
  const { width, height } = page.getSize();
  const headerHeight = continued ? 64 : 92;
  page.drawRectangle({ x: 0, y: height - headerHeight, width, height: headerHeight, color: COLORS.ivory });
  page.drawRectangle({ x: 0, y: height - headerHeight - 8, width, height: 8, color: COLORS.navy });
  page.drawRectangle({ x: 0, y: height - headerHeight - 13, width, height: 5, color: COLORS.gold });
  if (logo) drawContainedImage(page, logo, MARGIN, height - headerHeight + 8, continued ? 45 : 58, continued ? 45 : 70);
  const textX = logo ? MARGIN + (continued ? 58 : 76) : MARGIN;
  page.drawText("GEORGIA HIGH SCHOOL MUSICAL THEATRE AWARDS", { x: textX, y: height - (continued ? 27 : 28), size: continued ? 7.5 : 8.5, font: fonts.bold, color: COLORS.navy });
  page.drawText(`${clean(title)}${continued ? " - CONTINUED" : ""}`, { x: textX, y: height - (continued ? 47 : 57), size: continued ? 14 : 20, font: fonts.serif, color: COLORS.ink });
  if (!continued) page.drawText(fitText(fonts.regular, subtitle, 8, width - textX - MARGIN), { x: textX, y: height - 76, size: 8, font: fonts.regular, color: COLORS.muted });
}

function drawFooter(page: PDFPage, fonts: Fonts, pageNumber: number, pageCount: number) {
  const { width } = page.getSize();
  page.drawLine({ start: { x: MARGIN, y: 34 }, end: { x: width - MARGIN, y: 34 }, thickness: 1.3, color: COLORS.gold });
  page.drawText(`Generated ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`, { x: MARGIN, y: 18, size: 6.5, font: fonts.regular, color: COLORS.muted });
  const pageLabel = `Page ${pageNumber} of ${pageCount}`;
  page.drawText(pageLabel, { x: width - MARGIN - fonts.regular.widthOfTextAtSize(pageLabel, 7), y: 18, size: 7, font: fonts.regular, color: COLORS.muted });
}

function drawBand(page: PDFPage, fonts: Fonts, label: string, y: number, options?: { dark?: boolean; small?: boolean }) {
  const { width } = page.getSize();
  const height = options?.small ? 20 : 27;
  page.drawRectangle({ x: MARGIN, y: y - height, width: width - MARGIN * 2, height, color: options?.dark ? COLORS.navy : COLORS.goldSoft, borderColor: options?.dark ? COLORS.navy : COLORS.gold, borderWidth: 0.7 });
  page.drawRectangle({ x: MARGIN, y: y - height, width: 6, height, color: options?.dark ? COLORS.gold : COLORS.navy });
  page.drawText(fitText(fonts.bold, label.toUpperCase(), options?.small ? 7 : 9, width - MARGIN * 2 - 24), { x: MARGIN + 13, y: y - height + (options?.small ? 7 : 9), size: options?.small ? 7 : 9, font: fonts.bold, color: options?.dark ? COLORS.white : COLORS.navy });
  return y - height - 5;
}

function drawTableHeader(page: PDFPage, fonts: Fonts, columns: TableColumn[], y: number, x = MARGIN) {
  const height = 20;
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  page.drawRectangle({ x, y: y - height, width, height, color: COLORS.navy });
  let cursor = x;
  columns.forEach((column) => {
    if (column.label) {
      const label = fitText(fonts.bold, column.label.toUpperCase(), 6.3, column.width - 8);
      const labelWidth = fonts.bold.widthOfTextAtSize(label, 6.3);
      const textX = column.align === "right" ? cursor + column.width - labelWidth - 4 : column.align === "center" ? cursor + (column.width - labelWidth) / 2 : cursor + 4;
      page.drawText(label, { x: textX, y: y - 13, size: 6.3, font: fonts.bold, color: COLORS.white });
    }
    cursor += column.width;
  });
  return y - height;
}

function drawTableRow(page: PDFPage, fonts: Fonts, row: ReportRow, columns: TableColumn[], y: number, index: number, options?: { checkbox?: boolean; rowHeight?: number }) {
  const height = options?.rowHeight ?? 30;
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  page.drawRectangle({ x: MARGIN, y: y - height, width, height, color: index % 2 ? COLORS.row : COLORS.white, borderColor: COLORS.line, borderWidth: 0.35 });
  let cursor = MARGIN;
  columns.forEach((column) => {
    if (options?.checkbox && column.key === "_check") {
      page.drawRectangle({ x: cursor + (column.width - 9) / 2, y: y - height / 2 - 4, width: 9, height: 9, borderColor: COLORS.navy, borderWidth: 0.8 });
    } else {
      const lines = wrapText(fonts.regular, row[column.key], 6.4, column.width - 8, height >= 36 ? 3 : 2);
      lines.forEach((line, lineIndex) => {
        const lineWidth = fonts.regular.widthOfTextAtSize(line, 6.4);
        const textX = column.align === "right" ? cursor + column.width - lineWidth - 4 : column.align === "center" ? cursor + (column.width - lineWidth) / 2 : cursor + 4;
        page.drawText(line, { x: textX, y: y - 11 - lineIndex * 8, size: 6.4, font: fonts.regular, color: COLORS.ink });
      });
    }
    cursor += column.width;
    page.drawLine({ start: { x: cursor, y: y - height }, end: { x: cursor, y }, thickness: 0.3, color: COLORS.line });
  });
  return y - height;
}

function titleFor(report: LoadedReport) {
  return clean(report.definition.title).replace(/^GHSMTA\s+/i, "");
}

async function buildGroupedPortrait(report: LoadedReport, kind: "schedule" | "trucking" | "calls" | "sign-in") {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), serif: await pdf.embedFont(StandardFonts.TimesRomanBold) };
  const logo = await loadLogo(pdf);
  const pages: PDFPage[] = [];
  const title = titleFor(report);
  const subtitle = kind === "schedule" ? "Daily and advance production activity" : kind === "trucking" ? "Moves, stops, drivers, vehicles, and completion checks" : kind === "sign-in" ? "Daily crew attendance and sign-in" : "Crew assignments, times, departments, and notes";
  const addPage = (continued = pages.length > 0): PageState => {
    const page = pdf.addPage([PORTRAIT.width, PORTRAIT.height]);
    pages.push(page);
    drawHeader(page, fonts, logo, title, subtitle, continued);
    return { page, y: PORTRAIT.height - (continued ? 82 : 112), number: pages.length };
  };
  let state = addPage(false);

  if (report.rows.length === 0) {
    state.page.drawText("No records matched the selected filters.", { x: MARGIN, y: state.y - 20, size: 11, font: fonts.bold, color: COLORS.ink });
  } else if (kind === "schedule") {
    const columns: TableColumn[] = [{ key: "_check", label: "", width: 20 }, { key: "time", label: "Time", width: 88 }, { key: "event", label: "What", width: 205 }, { key: "department", label: "Department", width: 115 }, { key: "location", label: "Location", width: 92 }];
    let lastDate = "";
    let lastProduction = "";
    report.rows.forEach((row, index) => {
      const date = rowText(row, "date");
      const production = rowText(row, "production") || "General GHSMTA";
      const needsDate = date !== lastDate;
      const needsProduction = needsDate || production !== lastProduction;
      const required = 30 + (needsDate ? 32 : 0) + (needsProduction ? 25 : 0);
      if (state.y - required < 50) { state = addPage(); lastDate = ""; lastProduction = ""; }
      if (date !== lastDate) { state.y = drawBand(state.page, fonts, date || "Date not set", state.y, { dark: true }); lastDate = date; lastProduction = ""; }
      if (production !== lastProduction) { state.y = drawBand(state.page, fonts, production, state.y, { small: true }); state.y = drawTableHeader(state.page, fonts, columns, state.y); lastProduction = production; }
      state.y = drawTableRow(state.page, fonts, row, columns, state.y, index, { checkbox: true, rowHeight: 30 });
    });
  } else if (kind === "trucking") {
    const columns: TableColumn[] = [{ key: "_check", label: "", width: 20 }, { key: "time", label: "Time", width: 78 }, { key: "move", label: "What", width: 92 }, { key: "location", label: "Where", width: 122 }, { key: "driver", label: "Who", width: 88 }, { key: "notes", label: "Notes", width: 83 }, { key: "vehicle", label: "Vehicle", width: 57 }];
    let lastProduction = "";
    report.rows.forEach((row, index) => {
      const production = rowText(row, "production") || "General GHSMTA";
      const needsGroup = production !== lastProduction;
      if (state.y - 38 - (needsGroup ? 50 : 0) < 50) { state = addPage(); lastProduction = ""; }
      if (production !== lastProduction) { state.y = drawBand(state.page, fonts, production, state.y, { dark: true }); state.y = drawTableHeader(state.page, fonts, columns, state.y); lastProduction = production; }
      state.y = drawTableRow(state.page, fonts, row, columns, state.y, index, { checkbox: true, rowHeight: 38 });
    });
  } else {
    const signIn = kind === "sign-in";
    const columns: TableColumn[] = signIn
      ? [{ key: "person", label: "Name", width: 150 }, { key: "department", label: "Department", width: 95 }, { key: "job", label: "Position", width: 105 }, { key: "time_1", label: "Scheduled", width: 105 }, { key: "_signature", label: "Signature / Actual", width: 85 }]
      : [{ key: "person", label: "Name", width: 105 }, { key: "job", label: "Role", width: 83 }, { key: "time_1", label: "Time 1", width: 82 }, { key: "time_2", label: "Time 2", width: 82 }, { key: "time_3", label: "Time 3", width: 82 }, { key: "department", label: "Department", width: 106 }];
    let lastCall = "";
    report.rows.forEach((row, index) => {
      const callKey = rowText(row, "call_id") || `${rowText(row, "date")}-${rowText(row, "call")}`;
      const needsGroup = callKey !== lastCall;
      if (state.y - 34 - (needsGroup ? 75 : 0) < 50) { state = addPage(); lastCall = ""; }
      if (callKey !== lastCall) {
        const heading = `${rowText(row, "production")} - ${rowText(row, "call")}`;
        state.y = drawBand(state.page, fonts, heading, state.y, { dark: true });
        const meta = [rowText(row, "date"), rowText(row, "call_time"), rowText(row, "location"), rowText(row, "status")].filter(Boolean).join("  |  ");
        state.page.drawText(fitText(fonts.regular, meta, 7, PORTRAIT.width - MARGIN * 2), { x: MARGIN, y: state.y - 8, size: 7, font: fonts.regular, color: COLORS.muted });
        state.y -= 19;
        state.y = drawTableHeader(state.page, fonts, columns, state.y);
        lastCall = callKey;
      }
      state.y = drawTableRow(state.page, fonts, row, columns, state.y, index, { rowHeight: signIn ? 38 : 31 });
    });
  }

  pages.forEach((page, index) => drawFooter(page, fonts, index + 1, pages.length));
  return pdf.save();
}

async function buildLandscapeTable(report: LoadedReport) {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), serif: await pdf.embedFont(StandardFonts.TimesRomanBold) };
  const logo = await loadLogo(pdf);
  const pages: PDFPage[] = [];
  const title = titleFor(report);
  const keys = report.columns.map((column) => column.key);
  const preferredWidths: Record<string, number> = {
    date: 55, time: 60, call: 90, production: 92, person: 95, department: 75, job: 70,
    sessions: 105, rate: 55, estimated: 65, actual: 65, gl: 60, original: 72, changes: 72,
    current: 72, forecast: 72, remaining: 72, description: 125, vendor: 80, amount: 65,
    status: 55, invoice: 44, receipt: 44, vehicle: 92, type: 55, unit: 68, location: 100,
    door: 60, capacity: 105, notes: 115,
  };
  const available = LANDSCAPE.width - MARGIN * 2;
  const rawWidths = keys.map((key) => preferredWidths[key] ?? 78);
  const scale = available / rawWidths.reduce((sum, width) => sum + width, 0);
  const columns: TableColumn[] = report.columns.map((column, index) => ({ key: column.key, label: column.label, width: rawWidths[index] * scale, align: ["original", "changes", "current", "forecast", "remaining", "amount", "estimated", "actual", "rate"].includes(column.key) ? "right" : "left" }));
  const addPage = (continued = pages.length > 0): PageState => {
    const page = pdf.addPage([LANDSCAPE.width, LANDSCAPE.height]);
    pages.push(page);
    drawHeader(page, fonts, logo, title, "GHSMTA Production Operations", continued);
    let y = LANDSCAPE.height - (continued ? 81 : 111);
    y = drawTableHeader(page, fonts, columns, y);
    return { page, y, number: pages.length };
  };
  let state = addPage(false);
  if (report.rows.length === 0) {
    state.page.drawText("No records matched the selected filters.", { x: MARGIN, y: state.y - 20, size: 11, font: fonts.bold, color: COLORS.ink });
  } else {
    report.rows.forEach((row, index) => {
      if (state.y - 32 < 50) state = addPage();
      state.y = drawTableRow(state.page, fonts, row, columns, state.y, index, { rowHeight: 32 });
    });
  }
  pages.forEach((page, index) => drawFooter(page, fonts, index + 1, pages.length));
  return pdf.save();
}

export async function buildOperationsProductionPdf(report: LoadedReport) {
  const id = report.definition.id;
  if (id.startsWith("production-schedule-")) return buildGroupedPortrait(report, "schedule");
  if (id === "daily-trucking-schedule") return buildGroupedPortrait(report, "trucking");
  if (id === "call-sheets") return buildGroupedPortrait(report, "calls");
  if (id === "daily-call-sign-in") return buildGroupedPortrait(report, "sign-in");
  return buildLandscapeTable(report);
}
