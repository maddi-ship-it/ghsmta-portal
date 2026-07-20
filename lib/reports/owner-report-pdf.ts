import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

export type OwnerReportName =
  | "missing-comments"
  | "missing-scores"
  | "specialty-awards";

type ReportRow = Record<string, unknown>;

type Column = {
  key: string;
  label: string;
  width: number;
  maxLines?: number;
};

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN = 30;
const TABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const HEADER_HEIGHT = 82;
const TABLE_HEADER_HEIGHT = 24;
const FOOTER_HEIGHT = 28;

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

function titleCase(value: unknown) {
  return cleanText(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function wrapText(
  font: PDFFont,
  value: unknown,
  fontSize: number,
  maxWidth: number,
  maxLines = 4,
) {
  const source = cleanText(value) || "-";
  const paragraphs = source.split(/\n+/);
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

      if (lines.length >= maxLines) break;
    }

    if (current && lines.length < maxLines) {
      lines.push(current);
    }

    if (lines.length >= maxLines) break;
  }

  if (lines.length === 0) lines.push("-");

  const allText = paragraphs.join(" ");
  const rendered = lines.join(" ");
  if (rendered.length < allText.length && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (
      last.length > 0 &&
      font.widthOfTextAtSize(`${last}...`, fontSize) > maxWidth
    ) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = `${last}...`;
  }

  return lines;
}

function reportTitle(report: OwnerReportName) {
  if (report === "missing-comments") return "Comments Missing";
  if (report === "missing-scores") return "Scores Missing";
  return "Specialty Award Recommendations";
}

function reportSubtitle(report: OwnerReportName) {
  if (report === "missing-comments") {
    return "Active criterion comments that still require completion.";
  }
  if (report === "missing-scores") {
    return "Active criterion scores that still require completion.";
  }
  return "Internal Advisory Committee specialty award recommendations.";
}

function columnsForReport(report: OwnerReportName): Column[] {
  if (report === "specialty-awards") {
    return [
      { key: "school", label: "School / Production", width: 130, maxLines: 3 },
      { key: "award", label: "Award", width: 110, maxLines: 3 },
      { key: "advisory", label: "Advisory Member", width: 118, maxLines: 3 },
      { key: "song", label: "Song", width: 92, maxLines: 3 },
      { key: "why", label: "Why", width: 226, maxLines: 5 },
      { key: "status", label: "Status", width: 56, maxLines: 2 },
    ];
  }

  return [
    { key: "school", label: "School / Production", width: 148, maxLines: 3 },
    { key: "panel", label: "Panel Member", width: 138, maxLines: 3 },
    { key: "category", label: "Category", width: 120, maxLines: 3 },
    { key: "criterion", label: "Criterion", width: 238, maxLines: 4 },
    { key: "status", label: "Status", width: 88, maxLines: 2 },
  ];
}

function normalizeRows(
  report: OwnerReportName,
  rows: ReportRow[],
): Record<string, string>[] {
  if (report === "specialty-awards") {
    return rows.map((row) => ({
      school: [
        cleanText(row.school_name),
        cleanText(row.production_title),
      ]
        .filter(Boolean)
        .join("\n"),
      award: [
        titleCase(row.award_type),
        titleCase(row.recommendation_status),
      ]
        .filter(Boolean)
        .join("\n"),
      advisory: cleanText(row.advisory_member_name),
      song: cleanText(row.song_title) || "-",
      why: cleanText(row.explanation) || "-",
      status: titleCase(row.status),
    }));
  }

  return rows.map((row) => ({
    school: [
      cleanText(row.school_name),
      cleanText(row.production_title),
    ]
      .filter(Boolean)
      .join("\n"),
    panel: [
      cleanText(row.adjudicator_name),
      cleanText(row.adjudicator_email),
    ]
      .filter(Boolean)
      .join("\n"),
    category: cleanText(row.category_title),
    criterion: cleanText(row.criterion_title),
    status: titleCase(row.scorecard_status),
  }));
}

function drawPageHeader(
  page: PDFPage,
  bold: PDFFont,
  regular: PDFFont,
  report: OwnerReportName,
  rowCount: number,
  generatedAt: string,
) {
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - HEADER_HEIGHT,
    width: PAGE_WIDTH,
    height: HEADER_HEIGHT,
    color: COLORS.navy,
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
    y: PAGE_HEIGHT - 29,
    size: 8.5,
    font: bold,
    color: COLORS.gold,
  });

  page.drawText(reportTitle(report), {
    x: MARGIN,
    y: PAGE_HEIGHT - 53,
    size: 20,
    font: bold,
    color: COLORS.white,
  });

  page.drawText(reportSubtitle(report), {
    x: MARGIN,
    y: PAGE_HEIGHT - 69,
    size: 8.5,
    font: regular,
    color: rgb(220 / 255, 229 / 255, 1),
  });

  const summary = `${rowCount} record${rowCount === 1 ? "" : "s"}`;
  const summaryWidth = bold.widthOfTextAtSize(summary, 11);
  page.drawText(summary, {
    x: PAGE_WIDTH - MARGIN - summaryWidth,
    y: PAGE_HEIGHT - 42,
    size: 11,
    font: bold,
    color: COLORS.ivory,
  });

  const generatedWidth = regular.widthOfTextAtSize(generatedAt, 7.5);
  page.drawText(generatedAt, {
    x: PAGE_WIDTH - MARGIN - generatedWidth,
    y: PAGE_HEIGHT - 58,
    size: 7.5,
    font: regular,
    color: rgb(220 / 255, 229 / 255, 1),
  });
}

function drawTableHeader(
  page: PDFPage,
  bold: PDFFont,
  columns: Column[],
) {
  let x = MARGIN;
  const y = PAGE_HEIGHT - HEADER_HEIGHT - TABLE_HEADER_HEIGHT;

  page.drawRectangle({
    x: MARGIN,
    y,
    width: TABLE_WIDTH,
    height: TABLE_HEADER_HEIGHT,
    color: COLORS.midnight,
  });

  for (const column of columns) {
    page.drawText(column.label.toUpperCase(), {
      x: x + 5,
      y: y + 8,
      size: 6.5,
      font: bold,
      color: COLORS.gold,
    });
    x += column.width;
  }

  return y;
}

function addReportPage(
  pdf: PDFDocument,
  bold: PDFFont,
  regular: PDFFont,
  report: OwnerReportName,
  rowCount: number,
  generatedAt: string,
  columns: Column[],
) {
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawPageHeader(page, bold, regular, report, rowCount, generatedAt);
  const tableY = drawTableHeader(page, bold, columns);
  return {
    page,
    y: tableY,
  };
}

export async function buildOwnerReportPdf(
  report: OwnerReportName,
  rawRows: ReportRow[],
) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(`GHSMTA ${reportTitle(report)}`);
  pdf.setAuthor("GHSMTA Awards Portal");
  pdf.setSubject(reportSubtitle(report));
  pdf.setCreator("GHSMTA Awards Portal");
  pdf.setProducer("GHSMTA Awards Portal");

  const generatedAt = `Generated ${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date())} ET`;

  const rows = normalizeRows(report, rawRows);
  const columns = columnsForReport(report);

  let current = addReportPage(
    pdf,
    bold,
    regular,
    report,
    rows.length,
    generatedAt,
    columns,
  );

  if (rows.length === 0) {
    current.page.drawText("No records were found for this active report.", {
      x: MARGIN + 12,
      y: current.y - 38,
      size: 12,
      font: regular,
      color: COLORS.muted,
    });
  }

  rows.forEach((row, rowIndex) => {
    const wrapped = columns.map((column) =>
      wrapText(
        regular,
        row[column.key],
        7.4,
        column.width - 10,
        column.maxLines ?? 4,
      ),
    );
    const maxLines = Math.max(...wrapped.map((lines) => lines.length));
    const rowHeight = Math.max(24, maxLines * 9.2 + 10);

    if (
      current.y - rowHeight <
      MARGIN + FOOTER_HEIGHT
    ) {
      current = addReportPage(
        pdf,
        bold,
        regular,
        report,
        rows.length,
        generatedAt,
        columns,
      );
    }

    current.y -= rowHeight;

    current.page.drawRectangle({
      x: MARGIN,
      y: current.y,
      width: TABLE_WIDTH,
      height: rowHeight,
      color: rowIndex % 2 === 0 ? COLORS.white : COLORS.soft,
      borderColor: COLORS.line,
      borderWidth: 0.4,
    });

    let x = MARGIN;
    columns.forEach((column, columnIndex) => {
      const lines = wrapped[columnIndex];
      lines.forEach((line, lineIndex) => {
        current.page.drawText(line, {
          x: x + 5,
          y: current.y + rowHeight - 11 - lineIndex * 9.2,
          size: 7.4,
          font:
            column.key === "school" && lineIndex === 0
              ? bold
              : regular,
          color: COLORS.text,
        });
      });

      x += column.width;

      if (columnIndex < columns.length - 1) {
        current.page.drawLine({
          start: { x, y: current.y },
          end: { x, y: current.y + rowHeight },
          color: COLORS.line,
          thickness: 0.35,
        });
      }
    });
  });

  const pages = pdf.getPages();
  pages.forEach((page, pageIndex) => {
    const footerY = 17;

    page.drawLine({
      start: { x: MARGIN, y: FOOTER_HEIGHT },
      end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_HEIGHT },
      color: COLORS.line,
      thickness: 0.6,
    });

    page.drawText(
      "GHSMTA Awards Portal - Internal Owner Report",
      {
        x: MARGIN,
        y: footerY,
        size: 6.8,
        font: regular,
        color: COLORS.muted,
      },
    );

    const pageLabel = `Page ${pageIndex + 1} of ${pages.length}`;
    const pageLabelWidth = regular.widthOfTextAtSize(pageLabel, 6.8);
    page.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - pageLabelWidth,
      y: footerY,
      size: 6.8,
      font: regular,
      color: COLORS.muted,
    });
  });

  return pdf.save();
}
