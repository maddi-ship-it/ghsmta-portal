import { describe, expect, it } from "vitest";

import { formatInvoiceAmount } from "./types";

describe("formatInvoiceAmount", () => {
  it("formats every configured cycle price", () => {
    expect(formatInvoiceAmount(60_000)).toBe("$600.00");
    expect(formatInvoiceAmount(25_000)).toBe("$250.00");
    expect(formatInvoiceAmount(0)).toBe("$0.00");
    expect(formatInvoiceAmount(15_000)).toBe("$150.00");
  });
});
