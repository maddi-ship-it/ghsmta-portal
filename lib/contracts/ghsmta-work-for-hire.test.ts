import { readFile } from "node:fs/promises";
import path from "node:path";

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildGhsmtaWorkForHireDocument } from "./ghsmta-work-for-hire";

describe("GHSMTA work-for-hire contract", () => {
  it("keeps the supplied Word package and fills contract-specific values", async () => {
    const template = await readFile(
      path.join(process.cwd(), "public", "templates", "ghsmta-work-for-hire-contract.docx"),
    );
    const result = buildGhsmtaWorkForHireDocument(template, {
      contractorName: "Alex Morgan",
      contractorAddress: "123 Theatre Way, Atlanta, GA 30339",
      roleTitle: "Stage Manager",
      foundationSignerName: "Jordan Lee",
      agreementDate: "2026-11-15",
      startsOn: "2026-12-01",
      endsOn: "2027-04-24",
      eventDate: "2027-04-16",
      totalConsideration: 7000,
      responsibilities: "Coordinate the production calendar.\nLead production meetings.",
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
      ],
    });

    const archive = unzipSync(result);
    const document = strFromU8(archive["word/document.xml"]);
    const visible = document.replace(/<[^>]+>/g, "").replaceAll("&amp;", "&");

    expect(archive["word/styles.xml"]).toBeDefined();
    expect(archive["word/footer1.xml"]).toBeDefined();
    expect(visible).toContain("Alex Morgan");
    expect(visible).toContain("Stage Manager");
    expect(visible).toContain("November 15, 2026");
    expect(visible).toContain("Coordinate the production calendar.");
    expect(visible).toContain("-$2,000 on 1/15/27 upon completion of pre-production planning");
    expect(visible).toContain("GHSMTA Stage Manager");
    expect(visible).not.toContain("Matthew Peddie");
    expect(visible).not.toContain("Rob Turner");
  });
});
