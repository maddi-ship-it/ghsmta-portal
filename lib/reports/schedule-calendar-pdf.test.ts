import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { LoadedReport, ReportRow } from "@/lib/reports/report-data";

import { buildScheduleCalendarPdf } from "./schedule-calendar-pdf";

function row(index: number, startsAt: string): ReportRow {
  return {
    cycle: "2026-2027 | Director Application",
    starts_at: startsAt,
    ends_at: new Date(new Date(startsAt).getTime() + 2.5 * 60 * 60 * 1000).toISOString(),
    school: `Demo School ${index}`,
    production: "Newsies",
    city: "Atlanta",
    venue: "Demo Theatre",
    advisory_member: "Beth Lenhart",
    assigned_adjudicators: "Julie Ann Rice; Amy Bridges; John Su",
    understudies: "Under Study",
    shadows: "Shadow One; Shadow Two; Shadow Three",
    pick_six_sent: true,
    moved_to_section_c: true,
    section_c_complete: false,
    final_results_released: false,
  };
}

function report(rows: ReportRow[]): LoadedReport {
  return {
    definition: {
      id: "adjudication-schedule-master",
      title: "Adjudication Schedule Master",
      description: "Monthly schedule",
      category: "Scheduling",
      source: "schedule",
      formats: ["pdf", "csv"],
      allowedRoles: ["owner"],
      columns: [],
    },
    columns: [],
    rows,
    warnings: [],
    generatedAt: "2026-10-25T18:00:00.000-04:00",
    filters: {
      cycleId: "",
      dateFrom: "",
      dateTo: "",
      school: "",
      status: "",
      format: "pdf",
      variant: "internal",
      includeArchived: false,
      includeInternalNotes: true,
      includeContactInfo: true,
      includeAdjudicatorIdentities: true,
      includeProtectedScores: false,
      sort: "",
      direction: "asc",
    },
  };
}

describe("buildScheduleCalendarPdf", () => {
  it("uses continuation pages after nine schools and starts each month on a new page", async () => {
    const januaryRows = Array.from({ length: 10 }, (_, index) =>
      row(index + 1, `2027-01-${String(index + 2).padStart(2, "0")}T00:00:00.000Z`),
    );
    const bytes = await buildScheduleCalendarPdf(
      report([...januaryRows, row(11, "2027-02-05T00:00:00.000Z")]),
    );
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getPageCount()).toBe(3);
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("omits open slots without a booked school from the calendar", async () => {
    const bytes = await buildScheduleCalendarPdf(
      report([
        row(1, "2027-03-05T00:00:00.000Z"),
        {
          starts_at: "2027-04-05T00:00:00.000Z",
          school: "",
        },
      ]),
    );
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getPageCount()).toBe(1);
  });
});
