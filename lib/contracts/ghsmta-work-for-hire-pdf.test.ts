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
    const adobeSignFields = [
      "abf_signature_agreement_es_:signer1:signature",
      "abf_date_agreement_es_:signer1:date",
      "contractor_signature_agreement_es_:signer2:signature",
      "contractor_date_agreement_es_:signer2:date",
      "abf_signature_schedule_b_es_:signer1:signature",
      "abf_date_schedule_b_es_:signer1:date",
      "contractor_signature_schedule_b_es_:signer2:signature",
      "contractor_date_schedule_b_es_:signer2:date",
    ];
    expect(pdf.getForm().getFields().map((field) => field.getName()).sort()).toEqual(
      [...adobeSignFields].sort(),
    );
    adobeSignFields.forEach((name) => {
      const field = pdf.getForm().getTextField(name);
      expect(field.acroField.getWidgets()).toHaveLength(1);
      expect(field.needsAppearancesUpdate()).toBe(false);
    });
    pdf.getPages().forEach((page) => {
      expect(page.getWidth()).toBe(612);
      expect(page.getHeight()).toBe(792);
    });
  });
});
