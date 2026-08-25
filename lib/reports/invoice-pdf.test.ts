import { describe, expect, it } from "vitest";

import { buildInvoiceBillToLines } from "./invoice-pdf";

describe("invoice PDF billing details", () => {
  it("replaces school snapshots with billing overrides", () => {
    const lines = buildInvoiceBillToLines({
      billing_name: "New Billing Organization",
      billing_address: "100 New Street\nSuite 200",
      billing_contact_name: "Jordan Billing",
      billing_contact_phone: "404-555-0200",
      recipient_email: "billing@example.org",
      school_address_snapshot: "1 Old School Road",
      school_phone_snapshot: "404-555-0100",
    });

    expect(lines).toEqual([
      "New Billing Organization",
      "Contact: Jordan Billing",
      "100 New Street",
      "Suite 200",
      "Billing phone: 404-555-0200",
      "billing@example.org",
    ]);
    expect(lines.join("\n")).not.toContain("Old School");
    expect(lines.join("\n")).not.toContain("404-555-0100");
  });

  it("uses school snapshots only when billing details are missing", () => {
    expect(
      buildInvoiceBillToLines({
        billing_name: "Example High School",
        billing_address: null,
        billing_contact_name: null,
        billing_contact_phone: null,
        recipient_email: "director@example.org",
        school_address_snapshot: "1 School Road\nAtlanta, GA 30339",
        school_phone_snapshot: "404-555-0100",
      }),
    ).toEqual([
      "Example High School",
      "1 School Road",
      "Atlanta, GA 30339",
      "School phone: 404-555-0100",
      "director@example.org",
    ]);
  });
});
