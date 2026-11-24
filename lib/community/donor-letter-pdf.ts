import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

export type DonorLetterFields = {
  letterDate: string;
  recipientName: string;
  recipientTitle: string;
  companyName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

export type DonorLetterFontBytes = {
  regular: Uint8Array;
  bold: Uint8Array;
};

type StyledRun = {
  text: string;
  bold?: boolean;
};

type StyledWord = {
  text: string;
  font: PDFFont;
  spaceBefore: boolean;
};

const PAGE_HEIGHT = 792;
const LEFT = 54.24;
const TEXT_WIDTH = 503.52;
const ADDRESS_FONT_SIZE = 9.5;
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);

function clean(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeForFont(font: PDFFont, value: string) {
  return Array.from(clean(value))
    .map((character) => {
      try {
        font.encodeText(character);
        return character;
      } catch {
        return "";
      }
    })
    .join("");
}

function cover(page: PDFPage, top: number, bottom: number) {
  page.drawRectangle({
    x: LEFT - 2,
    y: PAGE_HEIGHT - bottom - 1.5,
    width: TEXT_WIDTH + 4,
    height: bottom - top + 3,
    color: WHITE,
  });
}

function drawLine({
  page,
  font,
  text,
  top,
  bottom,
  size,
}: {
  page: PDFPage;
  font: PDFFont;
  text: string;
  top: number;
  bottom: number;
  size: number;
}) {
  cover(page, top, bottom);
  const safeText = safeForFont(font, text);
  let fittedSize = size;
  while (font.widthOfTextAtSize(safeText, fittedSize) > TEXT_WIDTH && fittedSize > 7.5) {
    fittedSize = Math.max(7.5, fittedSize - 0.15);
  }
  page.drawText(safeText, {
    x: LEFT,
    y: PAGE_HEIGHT - bottom + fittedSize * 0.23,
    size: fittedSize,
    font,
    color: BLACK,
  });
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number) {
  const words = safeForFont(font, text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
      return;
    }
    line = candidate;
  });

  if (line) lines.push(line);
  return lines;
}

function drawAddressBlock({
  page,
  font,
  fields,
}: {
  page: PDFPage;
  font: PDFFont;
  fields: DonorLetterFields;
}) {
  const titleAndCompany = `${fields.recipientTitle} | ${fields.companyName}`;
  const titleLines = wrapText(
    font,
    titleAndCompany,
    ADDRESS_FONT_SIZE,
    TEXT_WIDTH,
  );
  if (titleLines.length > 2) {
    throw new Error("The recipient title and company are too long for the donor letter template.");
  }

  const rows = [
    fields.letterDate,
    fields.recipientName,
    ...titleLines,
    fields.address,
    `${fields.city}, ${fields.state} ${fields.zip}`,
  ];
  const bottoms =
    rows.length === 5
      ? [105.8, 116.2, 126.5, 136.8, 147.2]
      : [99.9, 110.2, 120.5, 130.8, 141.1, 151.4];

  cover(page, rows.length === 5 ? 95.8 : 89.7, rows.length === 5 ? 147.2 : 151.4);
  rows.forEach((text, index) => {
    page.drawText(safeForFont(font, text), {
      x: LEFT,
      y: PAGE_HEIGHT - bottoms[index] + ADDRESS_FONT_SIZE * 0.23,
      size: ADDRESS_FONT_SIZE,
      font,
      color: BLACK,
    });
  });
}

function wordsForRuns(
  runs: StyledRun[],
  regular: PDFFont,
  bold: PDFFont,
) {
  const words: StyledWord[] = [];
  let pendingSpace = false;

  runs.forEach((run) => {
    const font = run.bold ? bold : regular;
    (run.text.match(/\s+|\S+/g) ?? []).forEach((part) => {
      if (/^\s+$/.test(part)) {
        pendingSpace = true;
        return;
      }
      words.push({
        text: safeForFont(font, part),
        font,
        spaceBefore: words.length > 0 && pendingSpace,
      });
      pendingSpace = false;
    });
  });

  return words;
}

function wrapWords(
  words: StyledWord[],
  regular: PDFFont,
  size: number,
  maxWidth: number,
) {
  const lines: StyledWord[][] = [];
  const spaceWidth = regular.widthOfTextAtSize(" ", size);
  let line: StyledWord[] = [];
  let lineWidth = 0;

  words.forEach((word) => {
    const width = word.font.widthOfTextAtSize(word.text, size);
    const precedingSpace = line.length && word.spaceBefore ? spaceWidth : 0;
    const proposed = lineWidth + precedingSpace + width;
    if (line.length && word.spaceBefore && proposed > maxWidth) {
      lines.push(line);
      line = [{ ...word, spaceBefore: false }];
      lineWidth = width;
      return;
    }
    line.push(word);
    lineWidth = proposed;
  });

  if (line.length) lines.push(line);
  return lines;
}

function drawStyledParagraph({
  page,
  regular,
  bold,
  runs,
  top,
  bottom,
  maxLines,
}: {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  runs: StyledRun[];
  top: number;
  bottom: number;
  maxLines: number;
}) {
  const words = wordsForRuns(runs, regular, bold);
  let size = 10.08;
  let lines = wrapWords(words, regular, size, TEXT_WIDTH);

  while (lines.length > maxLines && size > 7.5) {
    size = Math.max(7.5, size - 0.15);
    lines = wrapWords(words, regular, size, TEXT_WIDTH);
  }

  if (lines.length > maxLines) {
    throw new Error("The company name is too long for the donor letter template.");
  }

  cover(page, top, bottom);
  const lineHeight = 13.56 * (size / 10.08);
  const regularSpace = regular.widthOfTextAtSize(" ", size);
  let y = PAGE_HEIGHT - top - size * 0.78;

  lines.forEach((line, lineIndex) => {
    const wordsWidth = line.reduce(
      (sum, word) => sum + word.font.widthOfTextAtSize(word.text, size),
      0,
    );
    const gapCount = line.filter((word, index) => index > 0 && word.spaceBefore).length;
    const isLastLine = lineIndex === lines.length - 1;
    const spaceWidth =
      !isLastLine && gapCount > 0
        ? (TEXT_WIDTH - wordsWidth) / gapCount
        : regularSpace;
    let x = LEFT;

    line.forEach((word, wordIndex) => {
      if (wordIndex > 0 && word.spaceBefore) x += spaceWidth;
      page.drawText(word.text, { x, y, size, font: word.font, color: BLACK });
      x += word.font.widthOfTextAtSize(word.text, size);
    });

    y -= lineHeight;
  });
}

export async function buildDonorLetterPdf(
  templateBytes: Uint8Array,
  input: DonorLetterFields,
  fontBytes?: DonorLetterFontBytes,
) {
  const template = await PDFDocument.load(templateBytes);
  const templatePage = template.getPages()[0];
  if (
    !templatePage ||
    templatePage.getWidth() !== 612 ||
    templatePage.getHeight() !== PAGE_HEIGHT
  ) {
    throw new Error("The donor letter template is not the expected letter-size PDF.");
  }

  const pdf = await PDFDocument.create();
  const [background] = await pdf.embedPdf(template, [0]);
  const page = pdf.addPage([612, PAGE_HEIGHT]);
  page.drawPage(background, {
    x: 0,
    y: 0,
    width: 612,
    height: PAGE_HEIGHT,
  });
  if (fontBytes) pdf.registerFontkit(fontkit);
  const regular = fontBytes
    ? await pdf.embedFont(fontBytes.regular, { subset: true })
    : await pdf.embedFont(StandardFonts.Helvetica);
  const bold = fontBytes
    ? await pdf.embedFont(fontBytes.bold, { subset: true })
    : await pdf.embedFont(StandardFonts.HelveticaBold);
  const fields = {
    letterDate: clean(input.letterDate),
    recipientName: clean(input.recipientName),
    recipientTitle: clean(input.recipientTitle),
    companyName: clean(input.companyName),
    address: clean(input.address),
    city: clean(input.city),
    state: clean(input.state),
    zip: clean(input.zip),
  };

  drawAddressBlock({ page, font: regular, fields });
  drawLine({ page, font: regular, text: `Dear ${fields.recipientName},`, top: 154.9, bottom: 166.4, size: 10.08 });

  drawStyledParagraph({
    page,
    regular,
    bold,
    top: 175.6,
    bottom: 228,
    maxLines: 4,
    runs: [
      { text: "On behalf of ArtsBridge Foundation, the nonprofit education and outreach arm of Cobb Energy Performing Arts Centre, we invite " },
      { text: fields.companyName },
      { text: " to take part in an extraordinary opportunity: our " },
      { text: "Lasting Legacy Campaign", bold: true },
      { text: " supporting the " },
      { text: "19th annual Georgia High School Musical Theatre Awards (Shuler Awards)", bold: true },
      { text: ", culminating April 22, 2027." },
    ],
  });

  drawStyledParagraph({
    page,
    regular,
    bold,
    top: 509.9,
    bottom: 589.2,
    maxLines: 6,
    runs: [
      { text: "The Lasting Legacy Campaign", bold: true },
      { text: " offers corporate partners an extraordinary opportunity to demonstrate their commitment to Georgia's young people while gaining valuable brand recognition through the Shuler Awards. With sponsorships beginning at " },
      { text: "$25,000,", bold: true },
      { text: ` ${fields.companyName} can become the ` },
      { text: "exclusive naming sponsor of an available 2027 Shuler Award category.", bold: true },
      { text: " Benefits include recognition on the award, an opportunity to present during the live broadcast, and visibility through print, digital, and special-event promotions. Expanded sponsorship levels offer additional opportunities to maximize exposure and deepen the impact of your investment." },
    ],
  });

  drawStyledParagraph({
    page,
    regular,
    bold,
    top: 600.1,
    bottom: 638.9,
    maxLines: 3,
    runs: [
      { text: "Corporate partners are essential to sustaining the quality of this year-round program and the opportunities it creates for students and educators. We would welcome a conversation about the award category that best fits " },
      { text: fields.companyName },
      { text: " and how, together, we can build a lasting legacy for Georgia's students." },
    ],
  });

  pdf.setTitle(`GHSMTA Lasting Legacy Letter - ${fields.companyName}`);
  pdf.setAuthor("ArtsBridge Foundation");
  pdf.setSubject("GHSMTA Lasting Legacy Campaign donor letter");
  pdf.setCreator("GHSMTA Awards Portal");
  pdf.setModificationDate(new Date());

  return pdf.save({ useObjectStreams: false });
}
