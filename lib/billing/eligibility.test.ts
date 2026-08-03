import { describe, expect, it } from "vitest";

import { activeInvoiceApplicationIds } from "./eligibility";

describe("billing bulk-send eligibility", () => {
  it("keeps draft, sent, and paid invoices out of the send queue", () => {
    const active = activeInvoiceApplicationIds([
      { application_id: "draft-school", status: "draft" },
      { application_id: "sent-school", status: "sent" },
      { application_id: "paid-school", status: "paid" },
    ]);

    expect([...active]).toEqual([
      "draft-school",
      "sent-school",
      "paid-school",
    ]);
  });

  it("returns a school to the send queue after its invoice is voided", () => {
    const active = activeInvoiceApplicationIds([
      { application_id: "voided-school", status: "void" },
    ]);

    expect(active.has("voided-school")).toBe(false);
  });
});
