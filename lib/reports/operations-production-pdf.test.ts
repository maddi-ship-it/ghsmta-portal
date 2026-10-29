import { describe, expect, it } from "vitest";

import type { LoadedReport } from "@/lib/reports/report-data";
import { buildOperationsProductionPdf } from "@/lib/reports/operations-production-pdf";

function fixture(id: string, title: string, rows: Record<string, unknown>[], columns: { key: string; label: string }[] = []) {
  return {
    definition: { id, title },
    columns,
    rows,
    filters: {},
    warnings: [],
    generatedAt: "2026-10-29T12:00:00.000Z",
  } as unknown as LoadedReport;
}

describe("GHSMTA Production Operations PDFs", () => {
  it.each([
    fixture("production-schedule-daily", "GHSMTA Daily Production Schedule", [{ date: "Oct 30, 2026", time: "9:00 AM", event: "Production meeting", production: "Into the Woods", department: "Production", location: "Mainstage" }]),
    fixture("daily-trucking-schedule", "GHSMTA Daily Trucking Schedule", [{ time: "10:00 AM", move: "Load scenery", production: "Chicago", location: "Scene Shop", driver: "Driver", notes: "Dock 2", vehicle: "Truck 1" }]),
    fixture("call-sheets", "GHSMTA Production Call Sheets", [{ call_id: "call-1", date: "Oct 30, 2026", call_time: "9:00 AM - 5:00 PM", production: "Into the Woods", call: "Load-in", person: "Crew Member", department: "Scenic", job: "Carpenter", time_1: "9:00 AM - 1:00 PM" }]),
    fixture("budget-forecast", "GHSMTA Budget Forecast", [{ production: "Into the Woods", gl: "5100", department: "Scenic", original: "$1,000.00", changes: "$0.00", current: "$1,000.00", forecast: "$900.00", remaining: "$100.00" }], [{ key: "production", label: "Production" }, { key: "gl", label: "GL Code" }, { key: "department", label: "Department" }, { key: "original", label: "Original" }, { key: "changes", label: "Changes" }, { key: "current", label: "Current" }, { key: "forecast", label: "Forecast" }, { key: "remaining", label: "Remaining" }]),
  ])("renders a valid PDF for $definition.id", async (report) => {
    const bytes = await buildOperationsProductionPdf(report);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });
});
