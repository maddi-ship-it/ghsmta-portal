import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildAuditSchoolScoresXlsx } from "@/lib/reports/audit-school-scores-xlsx";
import type { LoadedReport } from "@/lib/reports/report-data";
import {
  auditSchoolScoreColumns,
  findReportDefinition,
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
        audit_application_id: "application-two",
        school_name: "Demo School 02",
        musical_production: "Chicago",
        reviewer: "Third Reviewer",
        direction_score: 7,
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
  it("builds the 68-column auditor workbook with grouped school rows", () => {
    const bytes = buildAuditSchoolScoresXlsx(reportFixture());
    const files = unzipSync(bytes);
    const sheet = new TextDecoder().decode(
      files["xl/worksheets/sheet1.xml"],
    );

    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(auditSchoolScoreColumns).toHaveLength(68);
    expect(sheet).toContain('<dimension ref="A1:BP4"/>');
    expect(sheet).toContain('<autoFilter ref="A1:BP4"/>');
    expect(sheet).toContain('xSplit="3" ySplit="1"');
    expect(sheet).toContain("NAMDE OF MUSICAL PRODUCTION");
    expect(sheet).toContain('<c r="E2" s="4" t="n"><v>8.5</v></c>');
    expect(sheet).toContain('<c r="A3" s="2" t="inlineStr"><is><t></t></is></c>');
    expect(sheet).toContain('<c r="A4" s="3" t="inlineStr"><is><t>Demo School 02</t></is></c>');
  });
});
