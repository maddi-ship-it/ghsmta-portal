import { readFile } from "node:fs/promises";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { buildDonorLetterPdf } from "./donor-letter-pdf";

describe("GHSMTA donor letter PDF", () => {
  it("creates a personalized, letter-sized PDF from the approved template", async () => {
    const template = await PDFDocument.create();
    template.addPage([612, 792]).drawRectangle({
      x: 0,
      y: 0,
      width: 612,
      height: 792,
    });
    const templateBytes = await template.save();

    const [regular, bold] = await Promise.all([
      readFile("public/fonts/liberation-sans/LiberationSans-Regular.ttf"),
      readFile("public/fonts/liberation-sans/LiberationSans-Bold.ttf"),
    ]);
    const result = await buildDonorLetterPdf(
      templateBytes,
      {
        letterDate: "November 22, 2026",
        recipientName: "Jordan Smith",
        recipientTitle: "Community Relations Director",
        companyName: "Georgia Community Foundation",
        address: "123 Peachtree Street NE",
        city: "Atlanta",
        state: "GA",
        zip: "30339",
      },
      {
        regular: new Uint8Array(regular),
        bold: new Uint8Array(bold),
      },
    );

    expect(Buffer.from(result).subarray(0, 5).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(result);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPages()[0].getWidth()).toBe(612);
    expect(pdf.getPages()[0].getHeight()).toBe(792);
    expect(pdf.getTitle()).toBe(
      "GHSMTA Lasting Legacy Letter - Georgia Community Foundation",
    );
  });

  it("rejects a template with the wrong page dimensions", async () => {
    const template = await PDFDocument.create();
    template.addPage([500, 700]);

    await expect(
      buildDonorLetterPdf(await template.save(), {
        letterDate: "November 22, 2026",
        recipientName: "Jordan Smith",
        recipientTitle: "Director",
        companyName: "Community Foundation",
        address: "123 Main Street",
        city: "Atlanta",
        state: "GA",
        zip: "30339",
      }),
    ).rejects.toThrow("expected letter-size PDF");
  });
});
