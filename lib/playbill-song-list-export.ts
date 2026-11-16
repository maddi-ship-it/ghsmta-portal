import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { ADJUDICATION_BRAIN_DUMP_LEDGER } from "./adjudication-brain-dump";
import {
  buildPlaybillSongListSections,
  type PlaybillSong,
} from "./playbill-song-list";

export type PlaybillSongListExport = {
  productionTitle: string;
  schoolName: string;
  songs: PlaybillSong[];
  sourceFileName: string;
};

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wordParagraph(
  value: string,
  options: { bold?: boolean; size?: number; spacingAfter?: number } = {},
) {
  const runProperties = [
    options.bold ? "<w:b/>" : "",
    options.size ? `<w:sz w:val="${options.size}"/>` : "",
  ].join("");
  const paragraphProperties = options.spacingAfter
    ? `<w:pPr><w:spacing w:after="${options.spacingAfter}"/></w:pPr>`
    : "";
  return `<w:p>${paragraphProperties}<w:r><w:rPr>${runProperties}</w:rPr><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
}

export function createPlaybillSongListDocx({
  productionTitle,
  schoolName,
  songs,
  sourceFileName,
}: PlaybillSongListExport) {
  const sections = buildPlaybillSongListSections(songs);
  const documentBody = [
    wordParagraph("Playbill Song List", {
      bold: true,
      size: 36,
      spacingAfter: 120,
    }),
    wordParagraph(productionTitle || "Untitled production", {
      bold: true,
      size: 28,
      spacingAfter: 60,
    }),
    wordParagraph(schoolName, { size: 22, spacingAfter: 180 }),
    ...sections.flatMap((section) => [
      wordParagraph(section.heading, {
        bold: true,
        size: 26,
        spacingAfter: 80,
      }),
      ...section.songs.map((song, index) =>
        wordParagraph(
          `${index + 1}. ${song.title}${song.performers ? ` — ${song.performers}` : ""}`,
          { size: 22, spacingAfter: 70 },
        ),
      ),
    ]),
    wordParagraph(`Source: ${sourceFileName}`, {
      size: 18,
      spacingAfter: 60,
    }),
  ].join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${documentBody}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`;

  return zipSync(
    {
      "[Content_Types].xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
      ),
      "_rels/.rels": strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
      ),
      "docProps/core.xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(productionTitle)} song list</dc:title><dc:creator>GHSMTA Portal</dc:creator></cp:coreProperties>`,
      ),
      "word/document.xml": strToU8(documentXml),
      "word/_rels/document.xml.rels": strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
      ),
    },
    { level: 6 },
  );
}

function wrapPdfText(text: string, maxWidth: number, measure: (value: string) => number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function pdfSafeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, " - ")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7e]/g, "?");
}

function fitPdfText(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
) {
  if (measure(text) <= maxWidth) return text;

  let fitted = text;
  while (fitted.length > 1 && measure(`${fitted}...`) > maxWidth) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted.trimEnd()}...`;
}

export async function createPlaybillSongListPdf({
  productionTitle,
  schoolName,
  songs,
  sourceFileName,
}: PlaybillSongListExport) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.05, 0.1, 0.2);
  const gold = rgb(0.84, 0.67, 0.22);
  const muted = rgb(0.35, 0.4, 0.5);
  const rule = rgb(0.76, 0.79, 0.84);
  const ledgerBackground = rgb(0.96, 0.94, 0.86);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  let page = document.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPage = () => {
    page = document.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
    page.drawText("PLAYBILL SONG LIST | NOTES", {
      x: margin,
      y,
      size: 9,
      font: bold,
      color: gold,
    });
    const continuationTitle = fitPdfText(
      pdfSafeText(productionTitle || "Untitled production"),
      250,
      (value) => regular.widthOfTextAtSize(value, 9),
    );
    page.drawText(continuationTitle, {
      x:
        pageWidth -
        margin -
        regular.widthOfTextAtSize(continuationTitle, 9),
      y,
      size: 9,
      font: regular,
      color: muted,
    });
    y -= 10;
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageWidth - margin, y },
      thickness: 1,
      color: gold,
    });
    y -= 24;
  };
  const ensureSpace = (height: number) => {
    if (y - height < margin) newPage();
  };
  const drawLines = ({
    color = navy,
    font = regular,
    size,
    text,
    width = pageWidth - margin * 2,
  }: {
    color?: ReturnType<typeof rgb>;
    font?: typeof regular;
    size: number;
    text: string;
    width?: number;
  }) => {
    const safeText = pdfSafeText(text);
    const lines = wrapPdfText(safeText, width, (value) =>
      font.widthOfTextAtSize(value, size),
    );
    const lineHeight = size * 1.35;
    ensureSpace(lines.length * lineHeight);
    for (const line of lines) {
      page.drawText(line, { x: margin, y, size, font, color });
      y -= lineHeight;
    }
  };

  drawLines({ text: "Playbill Song List", size: 22, font: bold });
  y -= 4;
  drawLines({
    text: productionTitle || "Untitled production",
    size: 16,
    font: bold,
  });
  drawLines({ text: schoolName, size: 11, color: muted });
  y -= 12;

  const ledgerItems = ADJUDICATION_BRAIN_DUMP_LEDGER.split("\n").slice(1);
  const ledgerRows = Math.ceil(ledgerItems.length / 2);
  const ledgerHeight = 34 + ledgerRows * 11;
  ensureSpace(ledgerHeight + 16);
  page.drawRectangle({
    x: margin,
    y: y - ledgerHeight,
    width: pageWidth - margin * 2,
    height: ledgerHeight,
    color: ledgerBackground,
    borderColor: gold,
    borderWidth: 0.8,
  });
  page.drawText("ADJUDICATION LEDGER", {
    x: margin + 12,
    y: y - 18,
    size: 9,
    font: bold,
    color: navy,
  });
  const ledgerColumnWidth = (pageWidth - margin * 2 - 24) / 2;
  ledgerItems.forEach((item, index) => {
    const column = Math.floor(index / ledgerRows);
    const row = index % ledgerRows;
    page.drawText(pdfSafeText(item), {
      x: margin + 12 + column * ledgerColumnWidth,
      y: y - 34 - row * 11,
      size: 7.6,
      font: regular,
      color: navy,
    });
  });
  y -= ledgerHeight + 18;

  for (const section of buildPlaybillSongListSections(songs)) {
    ensureSpace(42);
    drawLines({ text: section.heading, size: 13, font: bold, color: gold });
    page.drawLine({
      start: { x: margin, y: y - 1 },
      end: { x: pageWidth - margin, y: y - 1 },
      thickness: 0.8,
      color: gold,
    });
    y -= 12;
    for (const [index, song] of section.songs.entries()) {
      const entryText = `${index + 1}. ${song.title}${song.performers ? ` - ${song.performers}` : ""}`;
      const safeEntryText = pdfSafeText(entryText);
      const entryLines = wrapPdfText(
        safeEntryText,
        pageWidth - margin * 2,
        (value) => bold.widthOfTextAtSize(value, 10.5),
      );
      ensureSpace(entryLines.length * 14.2 + 58);
      drawLines({
        text: entryText,
        size: 10.5,
        font: bold,
      });
      y -= 2;
      page.drawText("COMMENTS", {
        x: margin,
        y,
        size: 7,
        font: bold,
        color: muted,
      });
      y -= 11;
      for (let line = 0; line < 3; line += 1) {
        page.drawLine({
          start: { x: margin, y },
          end: { x: pageWidth - margin, y },
          thickness: 0.55,
          color: rule,
        });
        y -= 15;
      }
      y -= 4;
    }
    y -= 4;
  }

  const pages = document.getPages();
  const footerSource = fitPdfText(
    pdfSafeText(`Source: ${sourceFileName}`),
    365,
    (value) => regular.widthOfTextAtSize(value, 7.5),
  );
  pages.forEach((documentPage, index) => {
    documentPage.drawLine({
      start: { x: margin, y: 43 },
      end: { x: pageWidth - margin, y: 43 },
      thickness: 0.6,
      color: rule,
    });
    documentPage.drawText(footerSource, {
      x: margin,
      y: 29,
      size: 7.5,
      font: regular,
      color: muted,
    });
    const pageNumber = `Page ${index + 1} of ${pages.length}`;
    documentPage.drawText(pageNumber, {
      x:
        pageWidth -
        margin -
        regular.widthOfTextAtSize(pageNumber, 7.5),
      y: 29,
      size: 7.5,
      font: regular,
      color: muted,
    });
  });

  document.setTitle(`${productionTitle} song list`);
  document.setAuthor("GHSMTA Portal");
  return document.save();
}
