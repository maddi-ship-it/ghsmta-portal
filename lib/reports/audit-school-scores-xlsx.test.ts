import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildAuditSchoolScoresXlsx } from "@/lib/reports/audit-school-scores-xlsx";
import type { LoadedReport } from "@/lib/reports/report-data";
import {
  auditSchoolScoreColumns,
  findReportDefinition,
  visibleColumnsForVariant,
} from "@/lib/reports/report-definitions";

function reportFixture(): LoadedReport {
  const definition = findReportDefinition("audit-school-scores");
  if (!definition) throw new Error("Missing audit report definition.");
  return {
    definition,
    columns: auditSchoolScoreColumns,
    rows: [
      {
        audit_application_id: "application-one",
        school_name: "Demo School 01",
        musical_production: "Into the Woods",
        reviewer: "First Reviewer",
        direction_score: 8.5,
        direction_eligible: 1,
        direction_range: "8 – 10",
      },
      {
        audit_application_id: "application-one",
        school_name: "Demo School 01",
        musical_production: "Into the Woods",
        reviewer: "Second Reviewer",
        direction_score: 8.25,
        direction_eligible: 1,
        direction_range: "8 – 10",
      },
      {
        audit_application_id: "application-one",
        school_name: "Demo School 01",
        musical_production: "Into the Woods",
        reviewer: "Third Reviewer",
        direction_score: 8.75,
        direction_eligible: 1,
        direction_range: "8 – 10",
      },
      {
        audit_application_id: "application-two",
        school_name: "Demo School 02",
        musical_production: "Chicago",
        reviewer: "First Reviewer",
        direction_score: 7,
        direction_eligible: 0,
        direction_range: "6.5 – 8.5",
      },
      {
        audit_application_id: "application-two",
        school_name: "Demo School 02",
        musical_production: "Chicago",
        reviewer: "Second Reviewer",
        direction_score: 7.25,
        direction_eligible: 0,
        direction_range: "6.5 – 8.5",
      },
      {
        audit_application_id: "application-two",
        school_name: "Demo School 02",
        musical_production: "Chicago",
        reviewer: "Third Reviewer",
        direction_score: 7.5,
        direction_eligible: 0,
        direction_range: "6.5 – 8.5",
      },
    ],
    filters: {
      cycleId: "",
      dateFrom: "",
      dateTo: "",
      school: "",
      status: "",
      format: "xlsx",
      variant: "internal",
      includeArchived: false,
      includeInternalNotes: true,
      includeContactInfo: true,
      includeAdjudicatorIdentities: true,
      includeProtectedScores: true,
      sort: "",
      direction: "asc",
    },
    warnings: [],
    generatedAt: "2026-10-25T20:30:00.000Z",
  };
}

describe("buildAuditSchoolScoresXlsx", () => {
  it("builds the auditor workbook with merged schools and category rankings", () => {
    const bytes = buildAuditSchoolScoresXlsx(reportFixture());
    const files = unzipSync(bytes);
    const sheet = new TextDecoder().decode(
      files["xl/worksheets/sheet1.xml"],
    );
    const directionSummary = new TextDecoder().decode(
      files["xl/worksheets/sheet2.xml"],
    );
    const workbook = new TextDecoder().decode(files["xl/workbook.xml"]);

    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(auditSchoolScoreColumns).toHaveLength(68);
    expect(sheet).toContain('<dimension ref="A1:BP7"/>');
    expect(sheet).toContain('<autoFilter ref="A1:BP7"/>');
    expect(sheet).toContain('xSplit="3" ySplit="1"');
    expect(sheet).toContain("NAMDE OF MUSICAL PRODUCTION");
    expect(sheet).toContain('<c r="E2" s="4" t="n"><v>8.5</v></c>');
    expect(sheet).toContain('<c r="A3" s="2" t="inlineStr"><is><t></t></is></c>');
    expect(sheet).toContain('<mergeCell ref="A2:A4"/>');
    expect(sheet).toContain('<mergeCell ref="A5:A7"/>');
    expect(sheet).toContain('<c r="E5" s="7" t="n"><v>7</v></c>');
    expect(directionSummary).toContain("Top 10 Direction Scores");
    expect(directionSummary).toContain(
      '<c r="E5" s="11" t="n"><v>8.5</v></c>',
    );
    expect(directionSummary).not.toContain("Demo School 02");
    expect(workbook).toContain('<sheet name="Overall Production" sheetId="17"');
  });

  it("always includes protected audit columns", () => {
    const definition = findReportDefinition("audit-school-scores");
    if (!definition) throw new Error("Missing audit report definition.");

    const columns = visibleColumnsForVariant(definition, {
      variant: "internal",
      includeInternalNotes: false,
      includeContactInfo: false,
      includeAdjudicatorIdentities: false,
      includeProtectedScores: false,
    });

    expect(columns).toEqual(auditSchoolScoreColumns);
  });
});
