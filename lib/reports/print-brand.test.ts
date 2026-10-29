import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PDF_GENERATORS = [
  "application-reference-pdf.ts",
  "invoice-pdf.ts",
  "operations-production-pdf.ts",
  "owner-report-pdf.ts",
  "released-results-pdf.ts",
  "report-export.ts",
  "schedule-calendar-pdf.ts",
];

describe("GHSMTA PDF branding", () => {
  it.each(PDF_GENERATORS)("uses the shared print palette in %s", async (file) => {
    const source = await readFile(path.join(process.cwd(), "lib", "reports", file), "utf8");

    expect(source).toContain("GHSMTA_PRINT");
  });
});
