import { strToU8, zipSync } from "fflate";

import type { LoadedReport, ReportRow } from "@/lib/reports/report-data";

const DETAIL_SHEET_NAME = "Sheet1";
const SUMMARY_HEADERS = [
  "Rank",
  "School",
  "Production",
  "Nominee / Team",
  "Panel Average",
  "Panel Score 1",
  "Panel Score 2",
  "Panel Score 3",
] as const;

type AuditCategory = {
  key: string;
  title: string;
  sheetName: string;
  subjectKeys: string[];
  scoreKey: string;
  eligibilityKey: string;
  rangeKey: string;
};

function category(
  key: string,
  title: string,
  subjectKeys: string[] = [],
): AuditCategory {
  return {
    key,
    title,
    sheetName: title.slice(0, 31),
    subjectKeys,
    scoreKey: `${key}_score`,
    eligibilityKey: `${key}_eligible`,
    rangeKey: `${key}_range`,
  };
}

const AUDIT_CATEGORIES: AuditCategory[] = [
  category("direction", "Direction", ["direction_name"]),
  category("music_direction", "Music Direction", ["music_direction_name"]),
  category("orchestra", "Orchestra", ["orchestra_name"]),
  category("choreography", "Choreography", ["choreography_name"]),
  category("ensemble", "Ensemble"),
  category("technical_execution", "Technical Execution", [
    "technical_director_name",
    "stage_manager_name",
    "lighting_engineer_name",
    "sound_engineer_name",
  ]),
  category("lighting_design", "Lighting", ["lighting_design_name"]),
  category("sound_design", "Sound", ["sound_design_name"]),
  category("scenic_design", "Scenic Design", ["scenic_design_name"]),
  category("costume_design", "Costumes", ["costume_design_name"]),
  category("leading_actress", "Leading Actress", ["leading_actress_name"]),
  category("leading_actor", "Leading Actor", ["leading_actor_name"]),
  category("supporting_performer_a", "Supporting Performer A", [
    "supporting_performer_a_name",
  ]),
  category("supporting_performer_b", "Supporting Performer B", [
    "supporting_performer_b_name",
  ]),
  category("featured_performer", "Featured Performer", [
    "featured_performer_name",
  ]),
  category("overall_production", "Overall Production"),
];

const categoryByColumnKey = new Map(
  AUDIT_CATEGORIES.flatMap((auditCategory) =>
    [
      ...auditCategory.subjectKeys,
      auditCategory.scoreKey,
      auditCategory.eligibilityKey,
      auditCategory.rangeKey,
    ].map((columnKey) => [columnKey, auditCategory] as const),
  ),
);

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

function bodyStyleId(
  groupIndex: number,
  numeric: boolean,
  greyedOut: boolean,
) {
  if (greyedOut) return numeric ? 7 : 6;
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

function categoryIsEligible(value: unknown) {
  if (value === false || value === 0) return false;
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replaceAll(" ", "-");
  return ![
    "0",
    "false",
    "ineligible",
    "not-applicable",
    "notapplicable",
    "n/a",
  ].includes(normalized);
}

function schoolMergeReferences(report: LoadedReport) {
  const references: string[] = [];
  let previousKey = "";
  let groupStartRow = 2;

  report.rows.forEach((row, rowOffset) => {
    const rowIndex = rowOffset + 2;
    const currentKey = applicationKey(row);
    if (rowOffset > 0 && currentKey !== previousKey) {
      if (rowIndex - groupStartRow > 1) {
        references.push(`A${groupStartRow}:A${rowIndex - 1}`);
      }
      groupStartRow = rowIndex;
    }
    previousKey = currentKey;
  });

  const finalRow = report.rows.length + 1;
  if (report.rows.length > 0 && finalRow - groupStartRow >= 1) {
    references.push(`A${groupStartRow}:A${finalRow}`);
  }
  return references;
}

function detailWorksheetXml(report: LoadedReport) {
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
          const auditCategory = categoryByColumnKey.get(column.key);
          const greyedOut = auditCategory
            ? !categoryIsEligible(row[auditCategory.eligibilityKey])
            : false;
          return cellXml({
            columnIndex,
            rowIndex,
            value,
            styleId: bodyStyleId(groupIndex, numeric, greyedOut),
          });
        })
        .join("");
      return `<row r="${rowIndex}" ht="20" customHeight="1">${cells}</row>`;
    })
    .join("");
  const mergeReferences = schoolMergeReferences(report);
  const mergeCells =
    mergeReferences.length > 0
      ? `<mergeCells count="${mergeReferences.length}">${mergeReferences
          .map((reference) => `<mergeCell ref="${reference}"/>`)
          .join("")}</mergeCells>`
      : "";

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
  ${mergeCells}
  <autoFilter ref="A1:${lastColumn}${Math.max(lastRow, 1)}"/>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup paperSize="3" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

type CategorySummaryRow = {
  rank: number;
  school: string;
  production: string;
  subject: string;
  average: number;
  scores: [number, number, number];
};

function numericValue(value: unknown) {
  const number = Number(value);
  return value !== "" && value != null && Number.isFinite(number)
    ? number
    : null;
}

function categorySummaryRows(
  report: LoadedReport,
  auditCategory: AuditCategory,
) {
  const rowsByApplication = new Map<string, ReportRow[]>();
  for (const row of report.rows) {
    const key = applicationKey(row);
    const collection = rowsByApplication.get(key) ?? [];
    collection.push(row);
    rowsByApplication.set(key, collection);
  }

  const entries = [...rowsByApplication.values()].flatMap((applicationRows) => {
    const firstRow = applicationRows[0];
    if (!firstRow || !categoryIsEligible(firstRow[auditCategory.eligibilityKey])) {
      return [];
    }
    const scores = applicationRows
      .map((row) => numericValue(row[auditCategory.scoreKey]))
      .filter((score): score is number => score !== null);
    if (scores.length !== 3) return [];
    const panelScores = scores as [number, number, number];
    const average = Number(
      (
        panelScores.reduce((sum, score) => sum + score, 0) /
        panelScores.length
      ).toFixed(5),
    );
    const subject = auditCategory.subjectKeys
      .map((subjectKey) => String(firstRow[subjectKey] ?? "").trim())
      .filter(Boolean)
      .join("; ");
    return [
      {
        school: String(firstRow.school_name ?? ""),
        production: String(firstRow.musical_production ?? ""),
        subject,
        average,
        scores: panelScores,
      },
    ];
  });

  const topAverageScores = [
    ...new Set(entries.map((entry) => entry.average)),
  ]
    .sort((left, right) => right - left)
    .slice(0, 10);
  const rankByAverage = new Map(
    topAverageScores.map((average, index) => [average, index + 1]),
  );

  return entries
    .filter((entry) => rankByAverage.has(entry.average))
    .map(
      (entry): CategorySummaryRow => ({
        ...entry,
        rank: rankByAverage.get(entry.average) ?? 0,
      }),
    )
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.school.localeCompare(right.school, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
    );
}

function summaryWorksheetXml(
  report: LoadedReport,
  auditCategory: AuditCategory,
) {
  const summaryRows = categorySummaryRows(report, auditCategory);
  const lastRow = Math.max(summaryRows.length + 4, 5);
  const columnWidths = [8, 28, 28, 30, 16, 15, 15, 15];
  const columns = columnWidths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join("");
  const title = cellXml({
    columnIndex: 0,
    rowIndex: 1,
    value: `Top 10 ${auditCategory.title} Scores`,
    styleId: 8,
  });
  const note = cellXml({
    columnIndex: 0,
    rowIndex: 2,
    value:
      "Eligible entries with exactly three panel scores. Ties share a rank; the top 10 distinct averages are shown.",
    styleId: 9,
  });
  const headers = SUMMARY_HEADERS.map((header, columnIndex) =>
    cellXml({
      columnIndex,
      rowIndex: 4,
      value: header,
      styleId: 1,
    }),
  ).join("");
  const bodyRows = summaryRows
    .map((row, index) => {
      const rowIndex = index + 5;
      const values = [
        row.rank,
        row.school,
        row.production,
        row.subject,
        row.average,
        ...row.scores,
      ];
      const cells = values
        .map((value, columnIndex) =>
          cellXml({
            columnIndex,
            rowIndex,
            value,
            styleId:
              columnIndex === 0
                ? 12
                : typeof value === "number"
                  ? 11
                  : 10,
          }),
        )
        .join("");
      return `<row r="${rowIndex}" ht="20" customHeight="1">${cells}</row>`;
    })
    .join("");
  const emptyRow =
    summaryRows.length === 0
      ? `<row r="5" ht="20" customHeight="1">${cellXml({
          columnIndex: 0,
          rowIndex: 5,
          value: "No eligible entries have exactly three numeric panel scores.",
          styleId: 9,
        })}</row>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:H${lastRow}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A5" sqref="A5"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${columns}</cols>
  <sheetData>
    <row r="1" ht="24" customHeight="1">${title}</row>
    <row r="2" ht="20" customHeight="1">${note}</row>
    <row r="4" ht="32" customHeight="1">${headers}</row>
    ${bodyRows}
    ${emptyRow}
  </sheetData>
  <mergeCells count="2"><mergeCell ref="A1:H1"/><mergeCell ref="A2:H2"/></mergeCells>
  <autoFilter ref="A4:H${Math.max(summaryRows.length + 4, 4)}"/>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup paperSize="3" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="0.00000"/></numFmts>
  <fonts count="4">
    <font><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="14"/><name val="Arial"/><family val="2"/></font>
    <font><i/><color rgb="FF666666"/><sz val="10"/><name val="Arial"/><family val="2"/></font>
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
  <cellXfs count="13">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

export function buildAuditSchoolScoresXlsx(report: LoadedReport) {
  const generatedAt = new Date(report.generatedAt).toISOString();
  const sheets = [
    {
      name: DETAIL_SHEET_NAME,
      xml: detailWorksheetXml(report),
      printTitleRow: 1,
    },
    ...AUDIT_CATEGORIES.map((auditCategory) => ({
      name: auditCategory.sheetName,
      xml: summaryWorksheetXml(report, auditCategory),
      printTitleRow: 4,
    })),
  ];
  const worksheetOverrides = sheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  const workbookSheets = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  const printTitles = sheets
    .map(
      (sheet, index) =>
        `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">'${escapeXml(sheet.name)}'!$${sheet.printTitleRow}:$${sheet.printTitleRow}</definedName>`,
    )
    .join("");
  const workbookRelationships = sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");
  const styleRelationshipId = sheets.length + 1;
  const titlesOfParts = sheets
    .map((sheet) => `<vt:lpstr>${escapeXml(sheet.name)}</vt:lpstr>`)
    .join("");

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${worksheetOverrides}
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
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${titlesOfParts}</vt:vector></TitlesOfParts>
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
  <sheets>${workbookSheets}</sheets>
  <definedNames>${printTitles}</definedNames>
  <calcPr calcId="0" fullCalcOnLoad="1" forceFullCalc="1"/>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRelationships}
  <Relationship Id="rId${styleRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/styles.xml": strToU8(stylesXml()),
  };

  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheet.xml);
  });

  return zipSync(files, { level: 6 });
}
