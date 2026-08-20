import { describe, expect, it } from "vitest";

import {
  activeInvoiceApplicationIds,
  loadInvoiceableAcceptdApplicationIds,
  syncedAcceptdApplicationIds,
} from "./eligibility";

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

  it("only treats synced Acceptd application links as invoiceable", () => {
    const invoiceable = syncedAcceptdApplicationIds([
      { portal_application_id: "synced-school", mapping_status: "synced" },
      { portal_application_id: "mapped-school", mapping_status: "mapped" },
      { portal_application_id: "failed-school", mapping_status: "failed" },
      { portal_application_id: null, mapping_status: "synced" },
    ]);

    expect([...invoiceable]).toEqual(["synced-school"]);
  });

  it("loads only requested synced Acceptd application links", async () => {
    const rows = [
      { portal_application_id: "synced-school", mapping_status: "synced" },
      { portal_application_id: "other-school", mapping_status: "synced" },
      { portal_application_id: "pending-school", mapping_status: "mapped" },
    ];
    const supabase = {
      from() {
        const filters: Array<(row: (typeof rows)[number]) => boolean> = [];
        const query = {
          select() {
            return query;
          },
          in(column: keyof (typeof rows)[number], values: string[]) {
            filters.push((row) => values.includes(String(row[column] ?? "")));
            return query;
          },
          eq(column: keyof (typeof rows)[number], value: string) {
            filters.push((row) => row[column] === value);
            return query;
          },
          then<TResult1 = { data: typeof rows; error: null }>(
            onfulfilled?: (
              value: { data: typeof rows; error: null },
            ) => TResult1 | PromiseLike<TResult1>,
          ) {
            const data = rows.filter((row) =>
              filters.every((filter) => filter(row)),
            );
            return Promise.resolve({ data, error: null }).then(onfulfilled);
          },
        };
        return query;
      },
    };

    const invoiceable = await loadInvoiceableAcceptdApplicationIds(
      supabase,
      ["synced-school", "pending-school"],
    );

    expect([...invoiceable]).toEqual(["synced-school"]);
  });
});
