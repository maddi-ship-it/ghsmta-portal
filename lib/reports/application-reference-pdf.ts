import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

import {
  formatApplicationReferenceValue,
  type ApplicationReferencePanel,
} from "@/lib/application-reference-panels";
import { GHSMTA_PRINT } from "@/lib/reports/print-brand";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const NAVY = GHSMTA_PRINT.navy;
const GOLD = GHSMTA_PRINT.gold;
const SLATE = GHSMTA_PRINT.muted;
const RULE = GHSMTA_PRINT.line;

const PDF_SYMBOL_REPLACEMENTS: Record<string, string> = {
  "⚑": "[APPEAL]",
  "✓": "Yes",
  "✔": "Yes",
  "✕": "No",
  "✖": "No",
  "→": "->",
  "←": "<-",
};

export type ApplicationReferencePdfContext = {
  schoolName: string;
  productionTitle: string;
  generatedAt?: Date;
};

function splitLongToken(token: string, font: PDFFont, size: number, maxWidth: number) {
  const parts: string[] = [];
  let current = "";
  for (const character of token) {
    const candidate = `${current}${character}`;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      parts.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function safeText(text: string, font: PDFFont) {
  return Array.from(text)
    .map((character) => {
      if (character === "\n" || character === "\r") return character;
      try {
        font.encodeText(character);
        return character;
      } catch {
        return PDF_SYMBOL_REPLACEMENTS[character] ?? "";
      }
    })
    .join("");
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of safeText(text, font).replaceAll("\r", "").split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    const tokens = paragraph.split(/\s+/).flatMap((token) =>
      font.widthOfTextAtSize(token, size) > maxWidth
        ? splitLongToken(token, font, size, maxWidth)
        : [token],
    );
    let current = "";
    for (const token of tokens) {
      const candidate = current ? `${current} ${token}` : token;
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current);
        current = token;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export function applicationReferencePdfFilename(panel: ApplicationReferencePanel) {
  const slug = panel.key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "adjudication-view"}.pdf`;
}

export async function createApplicationReferencePdf(
  panel: ApplicationReferencePanel,
  context: ApplicationReferencePdfContext,
) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const generatedAt = context.generatedAt ?? new Date();

  let page: PDFPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN - 38;

  const drawPageHeader = () => {
    page.drawText("GHSMTA ADJUDICATION VIEW", {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN,
      size: 9,
      font: bold,
      color: GOLD,
    });
    page.drawText(
      safeText(`${context.schoolName} · ${context.productionTitle}`, regular),
      {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - 16,
      size: 8,
      font: regular,
      color: SLATE,
      maxWidth: CONTENT_WIDTH,
      },
    );
    y = PAGE_HEIGHT - MARGIN - 38;
  };

  const addPage = () => {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawPageHeader();
  };

  const ensureSpace = (height: number) => {
    if (y - height < MARGIN + 18) addPage();
  };

  const drawLines = (
    lines: string[],
    options: { font: PDFFont; size: number; color: ReturnType<typeof rgb>; indent?: number },
  ) => {
    const lineHeight = options.size + 4;
    for (const line of lines) {
      ensureSpace(lineHeight);
      if (line) {
        page.drawText(line, {
          x: MARGIN + (options.indent ?? 0),
          y,
          size: options.size,
          font: options.font,
          color: options.color,
        });
      }
      y -= lineHeight;
    }
  };

  drawPageHeader();
  drawLines(wrapText(panel.title, bold, 22, CONTENT_WIDTH), {
    font: bold,
    size: 22,
    color: NAVY,
  });
  y -= 4;
  drawLines(wrapText(panel.description, regular, 10, CONTENT_WIDTH), {
    font: regular,
    size: 10,
    color: SLATE,
  });
  y -= 12;

  for (const group of panel.groups) {
    if (!group.items.length) continue;
    ensureSpace(34);
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.8,
      color: RULE,
    });
    y -= 17;
    drawLines(wrapText(group.title.toUpperCase(), bold, 11, CONTENT_WIDTH), {
      font: bold,
      size: 11,
      color: NAVY,
    });
    y -= 5;

    for (const item of group.items) {
      const labelLines = wrapText(item.label, bold, 9, CONTENT_WIDTH);
      const value = formatApplicationReferenceValue(item.label, item.value);
      const valueLines = wrapText(value, regular, 9, CONTENT_WIDTH - 10);
      ensureSpace((labelLines.length + valueLines.length) * 13 + 9);
      drawLines(labelLines, { font: bold, size: 9, color: NAVY });
      drawLines(valueLines, {
        font: regular,
        size: 9,
        color: SLATE,
        indent: 10,
      });
      y -= 7;
    }
    y -= 8;
  }

  const pages = document.getPages();
  const generatedLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(generatedAt);
  pages.forEach((pdfPage, index) => {
    pdfPage.drawText(`Generated ${generatedLabel} ET`, {
      x: MARGIN,
      y: 25,
      size: 7,
      font: regular,
      color: SLATE,
    });
    const pageLabel = `${index + 1} / ${pages.length}`;
    pdfPage.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(pageLabel, 7),
      y: 25,
      size: 7,
      font: regular,
      color: SLATE,
    });
  });

  return document.save();
}
