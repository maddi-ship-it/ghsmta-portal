import { describe, expect, it } from "vitest";

import {
  DEFAULT_INVOICE_MESSAGE,
  DEFAULT_SCHOLARSHIP_SUBJECT,
  renderInvoiceMessageTemplate,
  resolveInvoiceDeliveryCopy,
} from "./delivery-copy";
import type { SchoolInvoice } from "./types";

function invoice(overrides: Partial<SchoolInvoice> = {}): SchoolInvoice {
  return {
    id: "invoice-1",
    invoice_number: "26GHSMTA101",
    cycle_id: "cycle-1",
    application_id: "application-1",
    option_key: "competition_full",
    description_snapshot: "Competition Track — Full Payment",
    amount_cents: 60_000,
    currency: "usd",
    document_kind: "invoice",
    payment_url: "https://example.com/pay",
    payment_promo_code: null,
    recipient_email: "school@example.com",
    billing_name: "Example High School",
    billing_address: null,
    billing_contact_name: null,
    billing_contact_phone: null,
    school_address_snapshot: null,
    school_phone_snapshot: null,
    school_type_snapshot: null,
    message_subject_snapshot: null,
    message_body_snapshot: null,
    status: "sent",
    issued_at: "2026-08-03T12:00:00.000Z",
    due_at: null,
    sent_at: "2026-08-03T12:00:00.000Z",
    paid_at: null,
    next_reminder_at: null,
    last_reminder_at: null,
    reminder_count: 0,
    delivery_status: "pending",
    last_delivery_at: null,
    reminder_claimed_at: null,
    reminder_claim_token: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    created_at: "2026-08-03T12:00:00.000Z",
    updated_at: "2026-08-03T12:00:00.000Z",
    ...overrides,
  };
}

describe("invoice delivery copy", () => {
  it("renders every supported personalization token", () => {
    expect(
      renderInvoiceMessageTemplate(
        "{{school_name}} · {{invoice_number}} · {{amount}} · {{description}}",
        {
          schoolName: "North High",
          invoiceNumber: "26GHSMTA101",
          amount: "$600.00",
          description: "Competition Track",
        },
      ),
    ).toBe("North High · 26GHSMTA101 · $600.00 · Competition Track");
  });

  it("uses the saved editable subject and message for invoice delivery", () => {
    const copy = resolveInvoiceDeliveryCopy(
      invoice({
        message_subject_snapshot: "Registration for {{school_name}}",
        message_body_snapshot: "Please review invoice {{invoice_number}} for {{amount}}.",
      }),
      "North High",
      "invoice",
    );

    expect(copy.subject).toBe("Registration for North High");
    expect(copy.body).toBe("Please review invoice 26GHSMTA101 for $600.00.");
  });

  it("falls back to the standard templates for historical invoices", () => {
    const copy = resolveInvoiceDeliveryCopy(invoice(), "North High", "invoice");

    expect(copy.body).toBe(
      renderInvoiceMessageTemplate(DEFAULT_INVOICE_MESSAGE, {
        schoolName: "North High",
        invoiceNumber: "26GHSMTA101",
        amount: "$600.00",
        description: "Competition Track — Full Payment",
      }),
    );
  });

  it("uses scholarship copy for a zero-dollar confirmation", () => {
    const copy = resolveInvoiceDeliveryCopy(
      invoice({
        amount_cents: 0,
        document_kind: "scholarship_confirmation",
        message_subject_snapshot: DEFAULT_SCHOLARSHIP_SUBJECT,
      }),
      "North High",
      "scholarship_confirmation",
    );

    expect(copy.subject).toBe("Scholarship confirmation — 26GHSMTA101");
    expect(copy.body).toContain("full scholarship");
  });
});
