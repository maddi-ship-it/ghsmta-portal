import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { createApplicationReferencePdf } from "./application-reference-pdf";

describe("application reference PDFs", () => {
  it("renders a valid multi-page PDF without dropping long responses", async () => {
    const longResponse = Array.from(
      { length: 220 },
      (_, index) => `Detailed application response ${index + 1}.`,
    ).join(" ");
    const bytes = await createApplicationReferencePdf(
      {
        key: "full-application",
        title: "Full Application",
        shortTitle: "FULL APPLICATION",
        description: "Every submitted application response.",
        groups: [
          {
            title: "Application responses",
            items: [
              { label: "Director's vision", value: longResponse },
              { label: "Music Direction - Award Eligible", value: "1" },
            ],
          },
        ],
      },
      {
        schoolName: "Rainey-McCullers School of the Arts",
        productionTitle: "Into The Woods",
        generatedAt: new Date("2026-10-11T16:00:00-04:00"),
      },
    );

    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  });
});
