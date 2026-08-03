import { describe, expect, it } from "vitest";

import {
  INVOICE_SCHOOL_CHAT_CHANNEL_TYPE,
  isInvoiceSchoolChatChannel,
} from "./delivery-routing";

describe("invoice chat routing", () => {
  it("routes invoices only to school-facing School Messaging", () => {
    expect(INVOICE_SCHOOL_CHAT_CHANNEL_TYPE).toBe("school_dm");
    expect(isInvoiceSchoolChatChannel("school_dm")).toBe(true);
    expect(isInvoiceSchoolChatChannel("school")).toBe(false);
  });
});
