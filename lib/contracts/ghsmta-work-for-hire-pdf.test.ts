import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { buildGhsmtaWorkForHirePdf } from "./ghsmta-work-for-hire-pdf";

describe("GHSMTA work-for-hire contract PDF", () => {
  it("creates a valid letter-sized agreement with the full contract structure", async () => {
    const result = await buildGhsmtaWorkForHirePdf({
      contractorName: "Alex Morgan",
      contractorAddress: "123 Theatre Way, Atlanta, GA 30339",
      roleTitle: "Stage Manager",
      foundationSignerName: "Jordan Lee",
      agreementDate: "2026-11-15",
      startsOn: "2026-12-01",
      endsOn: "2027-04-24",
      eventDate: "2027-04-16",
      totalConsideration: 7000,
      responsibilities: "Coordinate the production calendar.\nLead production meetings.\nSupervise rehearsal and performance operations.",
      transportation: "Mileage reimbursed with prior approval.",
      lodging: null,
      meals: null,
      outOfPocketExpenses: "Pre-approved supplies only.",
      communicationCredit: "GHSMTA Stage Manager",
      payments: [
        {
          label: "First installment",
          deliverable: "completion of pre-production planning",
          amount: 2000,
          due_date: "2027-01-15",
        },
        {
          label: "Final installment",
          deliverable: "successful completion of the GHSMTA",
          amount: 5000,
          due_date: "2027-04-24",
        },
      ],
    }, new Date("2026-11-16T17:00:00Z"));

    expect(Buffer.from(result).subarray(0, 5).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(result);
    expect(pdf.getTitle()).toBe("GHSMTA Contractor Agreement - Alex Morgan");
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(4);
    pdf.getPages().forEach((page) => {
      expect(page.getWidth()).toBe(612);
      expect(page.getHeight()).toBe(792);
    });
  });
});
