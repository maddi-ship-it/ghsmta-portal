import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type ContractDocumentPayment = {
  label: string;
  deliverable: string | null;
  amount: number;
  due_date: string | null;
};

export type ContractDocumentData = {
  contractorName: string;
  contractorAddress: string | null;
  roleTitle: string;
  foundationSignerName: string | null;
  agreementDate: string | null;
  startsOn: string | null;
  endsOn: string | null;
  eventDate: string | null;
  totalConsideration: number;
  responsibilities: string | null;
  transportation: string | null;
  lodging: string | null;
  meals: string | null;
  outOfPocketExpenses: string | null;
  communicationCredit: string | null;
  payments: ContractDocumentPayment[];
};

const COMPENSATION_TERMS =
  "Contractor must submit written invoice to Foundation no later than two weeks prior to expected date for receipt of payment. Compensation is dependent on Contractor’s successful execution of services as outlined in Schedule A and adherence to the policy in Schedule B. Successful execution of services will be at the Foundation’s sole discretion. Foundation reserves the right to withhold or delay payment should Foundation deem in its sole discretion that Contractor has failed to execute services as outlined in the Contract and its addenda. Contractor will receive no additional rights, benefits, or payments from the Foundation under this Agreement.";

function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function visibleText(xml: string) {
  return Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
    .map((match) => decodeXml(match[1]))
    .join("");
}

function replaceLogicalText(xml: string, search: string, replacement: string) {
  let result = xml;
  let searchFrom = 0;
  while (true) {
    const nodes = Array.from(
      result.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g),
    ).map((match) => ({
      start: match.index,
      contentStart: (match.index ?? 0) + match[0].indexOf(match[1]),
      contentEnd: (match.index ?? 0) + match[0].indexOf(match[1]) + match[1].length,
      text: decodeXml(match[1]),
    }));
    const combined = nodes.map((node) => node.text).join("");
    const foundAt = combined.indexOf(search, searchFrom);
    if (foundAt < 0) return result;

    const foundEnd = foundAt + search.length;
    let logicalOffset = 0;
    const changes: Array<{ start: number; end: number; value: string }> = [];
    let replacementWritten = false;

    for (const node of nodes) {
      const nodeStart = logicalOffset;
      const nodeEnd = nodeStart + node.text.length;
      logicalOffset = nodeEnd;
      if (nodeEnd <= foundAt || nodeStart >= foundEnd) continue;

      const prefix = foundAt > nodeStart ? node.text.slice(0, foundAt - nodeStart) : "";
      const suffix = foundEnd < nodeEnd ? node.text.slice(foundEnd - nodeStart) : "";
      const value = `${prefix}${replacementWritten ? "" : replacement}${suffix}`;
      replacementWritten = true;
      changes.push({ start: node.contentStart, end: node.contentEnd, value: escapeXml(value) });
    }

    for (const change of changes.reverse()) {
      result = `${result.slice(0, change.start)}${change.value}${result.slice(change.end)}`;
    }
    searchFrom = foundAt + replacement.length;
  }
}

function paragraphFromTemplate(templateCell: string, text: string) {
  const paragraph = templateCell.match(/<w:p([^>]*)>([\s\S]*?)<\/w:p>/);
  const paragraphAttributes = paragraph?.[1] ?? "";
  const paragraphBody = paragraph?.[2] ?? "";
  const paragraphProperties = paragraphBody.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
  const runProperties = paragraphBody.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
  return `<w:p${paragraphAttributes}>${paragraphProperties}<w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function replaceSecondCell(rowXml: string, paragraphs: string[]) {
  const cells = Array.from(rowXml.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g));
  const target = cells[1];
  if (!target || target.index === undefined) return rowXml;
  const cell = target[0];
  const opening = cell.match(/^<w:tc(?:\s[^>]*)?>/)?.[0] ?? "<w:tc>";
  const cellProperties = cell.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)?.[0] ?? "";
  const content = (paragraphs.length > 0 ? paragraphs : [""])
    .map((paragraph) => paragraphFromTemplate(cell, paragraph))
    .join("");
  const replacement = `${opening}${cellProperties}${content}</w:tc>`;
  return `${rowXml.slice(0, target.index)}${replacement}${rowXml.slice(target.index + cell.length)}`;
}

function replaceTableRow(xml: string, label: string, paragraphs: string[]) {
  return xml.replace(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g, (row) =>
    visibleText(row).startsWith(label) ? replaceSecondCell(row, paragraphs) : row,
  );
}

function removeTemplateSpacerBeforeScheduleB(xml: string) {
  const tableEnd = xml.indexOf("</w:tbl>");
  const scheduleB = xml.indexOf("SCHEDULE B", tableEnd);
  if (tableEnd < 0 || scheduleB < 0) return xml;
  const pageBreak = xml.lastIndexOf('w:type="page"', scheduleB);
  const paragraphStarts = Array.from(
    xml.slice(0, pageBreak).matchAll(/<w:p(?:\s[^>]*)?>/g),
  );
  const pageBreakStart = paragraphStarts.at(-1)?.index ?? -1;
  if (pageBreak < tableEnd || pageBreakStart < tableEnd) {
    return xml;
  }
  const spacer = xml.slice(tableEnd + "</w:tbl>".length, pageBreakStart);
  if (visibleText(spacer).trim() || /<w:(drawing|pict|object)\b/.test(spacer)) return xml;
  return `${xml.slice(0, tableEnd + "</w:tbl>".length)}${xml.slice(pageBreakStart)}`;
}

function formatLongDate(value: string | null, fallback: string) {
  if (!value) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function formatEventDate(value: string | null) {
  if (!value) return "the date set by the Foundation";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function formatShortDate(value: string | null) {
  if (!value) return "date to be determined";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function fieldLines(value: string | null, fallback: string) {
  const lines = (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [fallback];
}

export function buildGhsmtaWorkForHireDocument(
  template: Uint8Array,
  contract: ContractDocumentData,
) {
  const archive = unzipSync(template);
  const documentPath = "word/document.xml";
  const source = archive[documentPath];
  if (!source) throw new Error("The GHSMTA contract template is missing its document body.");

  const agreementDate = formatLongDate(contract.agreementDate, "the date signed below");
  const startsOn = formatLongDate(contract.startsOn, "the date signed below");
  const endsOn = formatLongDate(contract.endsOn, "satisfactory completion of the work");
  const eventDate = formatEventDate(contract.eventDate);
  const signer = contract.foundationSignerName?.trim() || "Foundation Representative";

  let xml = strFromU8(source);
  xml = replaceLogicalText(xml, "November 20, 2025", agreementDate);
  xml = replaceLogicalText(xml, "December 1, 2025", startsOn);
  xml = replaceLogicalText(xml, "April 24, 2026", endsOn);
  xml = replaceLogicalText(xml, "Thursday, April 16, 2026", eventDate);
  xml = replaceLogicalText(xml, "Matthew Peddie", contract.contractorName);
  xml = replaceLogicalText(xml, "Rob Turner", signer);
  xml = replaceLogicalText(xml, "Production Manager", contract.roleTitle);
  xml = replaceLogicalText(xml, "Address:", `Address: ${contract.contractorAddress?.trim() || ""}`);

  const responsibilityLines = fieldLines(
    contract.responsibilities,
    `Provide the services customarily associated with the GHSMTA ${contract.roleTitle} role as directed by the Foundation.`,
  );
  xml = replaceTableRow(xml, "SERVICES TO BE PROVIDED BY CONTRACTOR:", [
    `The GHSMTA ${contract.roleTitle} (Contractor) will provide the following services:`,
    ...responsibilityLines,
  ]);

  const payments = [...contract.payments].sort((left, right) => {
    if (left.due_date && right.due_date) return left.due_date.localeCompare(right.due_date);
    return left.label.localeCompare(right.label);
  });
  const paymentLines = payments.length > 0
    ? payments.map((payment) => {
        const deliverable = payment.deliverable?.trim();
        return `-${money(payment.amount)} on ${formatShortDate(payment.due_date)}${deliverable ? ` upon ${deliverable}` : ""}`;
      })
    : [`-${money(contract.totalConsideration)} according to the invoice schedule approved by the Foundation.`];
  xml = replaceTableRow(xml, "COMPENSATION", [
    `${money(contract.totalConsideration)} to be paid via the following schedule:`,
    ...paymentLines,
    COMPENSATION_TERMS,
  ]);

  xml = replaceTableRow(xml, "TRANSPORTATION:", fieldLines(contract.transportation, "N/A"));
  xml = replaceTableRow(xml, "LODGING:", fieldLines(contract.lodging, "N/A"));
  xml = replaceTableRow(
    xml,
    "MEALS:",
    fieldLines(
      contract.meals,
      "Except for meals provided by ArtsBridge Foundation, Contractor is responsible for all meals.",
    ),
  );
  xml = replaceTableRow(
    xml,
    "OUT OF POCKET EXPENSES:",
    fieldLines(contract.outOfPocketExpenses, "N/A"),
  );
  xml = replaceTableRow(
    xml,
    "COMMUNICATION OF CREDIT:",
    fieldLines(
      contract.communicationCredit,
      `Contractor will be provided the following program credit: GHSMTA ${contract.roleTitle}.`,
    ),
  );
  xml = removeTemplateSpacerBeforeScheduleB(xml);

  archive[documentPath] = strToU8(xml);
  return zipSync(archive, { level: 6 });
}

