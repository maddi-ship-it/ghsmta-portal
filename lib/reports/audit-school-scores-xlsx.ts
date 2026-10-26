import { strToU8, zipSync } from "fflate";

import type { LoadedReport, ReportRow } from "@/lib/reports/report-data";

const SHEET_NAME = "Sheet1";

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let current = index + 1;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function cellReference(columnIndex: number, rowIndex: number) {
  return `${columnName(columnIndex)}${rowIndex}`;
}

function columnWidth(label: string, index: number) {
  if (index === 0) return 28;
  if (index === 1) return 31;
  if (index === 2) return 24;
  if (/Name$/i.test(label) || /Name/i.test(label)) return 24;
  if (/2-Point Range/i.test(label)) return 19;
  if (/Eligible/i.test(label)) return 16;
  if (/Score/i.test(label)) return 16;
  return Math.min(Math.max(label.length + 3, 14), 24);
}

function bodyStyleId(groupIndex: number, numeric: boolean) {
  const green = groupIndex % 2 === 0;
  if (numeric) return green ? 4 : 5;
  return green ? 2 : 3;
}

function cellXml({
  columnIndex,
  rowIndex,
  value,
  styleId,
}: {
  columnIndex: number;
  rowIndex: number;
  value: unknown;
  styleId: number;
}) {
  const reference = cellReference(columnIndex, rowIndex);
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}" s="${styleId}" t="n"><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${reference}" s="${styleId}" t="n"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = String(value ?? "");
  const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${reference}" s="${styleId}" t="inlineStr"><is><t${preserve}>${escapeXml(text)}</t></is></c>`;
}

function applicationKey(row: ReportRow) {
  return String(
    row.audit_application_id ??
      `${row.school_name ?? ""}\u0000${row.musical_production ?? ""}`,
  );
}

function worksheetXml(report: LoadedReport) {
  const lastColumn = columnName(report.columns.length - 1);
  const lastRow = report.rows.length + 1;
  const columns = report.columns
    .map(
      (column, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${columnWidth(column.label, index)}" customWidth="1"/>`,
    )
    .join("");
  const headerCells = report.columns
    .map((column, index) =>
      cellXml({
        columnIndex: index,
        rowIndex: 1,
        value: column.label,
        styleId: 1,
      }),
    )
    .join("");

  let groupIndex = -1;
  let previousApplicationKey = "";
  const bodyRows = report.rows
    .map((row, rowOffset) => {
      const rowIndex = rowOffset + 2;
      const currentApplicationKey = applicationKey(row);
      const startsApplication = currentApplicationKey !== previousApplicationKey;
      if (startsApplication) groupIndex += 1;
      previousApplicationKey = currentApplicationKey;

      const cells = report.columns
        .map((column, columnIndex) => {
          let value = row[column.key];
          if (!startsApplication && columnIndex < 2) value = "";
          const numeric = typeof value === "number" || typeof value === "boolean";
          return cellXml({
            columnIndex,
            rowIndex,
            value,
            styleId: bodyStyleId(groupIndex, numeric),
          });
        })
        .join("");
      return `<row r="${rowIndex}" ht="20" customHeight="1">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:${lastColumn}${Math.max(lastRow, 1)}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane xSplit="3" ySplit="1" topLeftCell="D2" activePane="bottomRight" state="frozen"/>
      <selection pane="bottomRight" activeCell="D2" sqref="D2"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${columns}</cols>
  <sheetData>
    <row r="1" ht="44" customHeight="1">${headerCells}</row>
    ${bodyRows}
  </sheetData>
  <autoFilter ref="A1:${lastColumn}${Math.max(lastRow, 1)}"/>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup paperSize="3" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="0.00000"/></numFmts>
  <fonts count="2">
    <font><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="10"/><name val="Arial"/><family val="2"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9EAD3"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF4CCCC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF000000"/></left>
      <right style="thin"><color rgb="FF000000"/></right>
      <top style="thin"><color rgb="FF000000"/></top>
      <bottom style="thin"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

export function buildAuditSchoolScoresXlsx(report: LoadedReport) {
  const generatedAt = new Date(report.generatedAt).toISOString();
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`),
    "docProps/app.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>GHSMTA Awards Portal</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${SHEET_NAME}</vt:lpstr></vt:vector></TitlesOfParts>
</Properties>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>GHSMTA Audit School Scores</dc:title>
  <dc:creator>GHSMTA Awards Portal</dc:creator>
  <cp:lastModifiedBy>GHSMTA Awards Portal</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${generatedAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${generatedAt}</dcterms:modified>
</cp:coreProperties>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
  <sheets><sheet name="${SHEET_NAME}" sheetId="1" r:id="rId1"/></sheets>
  <definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${SHEET_NAME}'!$1:$1</definedName></definedNames>
  <calcPr calcId="0" fullCalcOnLoad="1" forceFullCalc="1"/>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/styles.xml": strToU8(stylesXml()),
    "xl/worksheets/sheet1.xml": strToU8(worksheetXml(report)),
  };

  return zipSync(files, { level: 6 });
}
