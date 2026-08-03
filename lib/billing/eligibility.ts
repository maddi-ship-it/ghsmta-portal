export type InvoiceEligibilityRow = {
  application_id: string;
  status: "draft" | "sent" | "paid" | "void";
};

export function activeInvoiceApplicationIds(rows: InvoiceEligibilityRow[]) {
  return new Set(
    rows
      .filter((invoice) => invoice.status !== "void")
      .map((invoice) => invoice.application_id),
  );
}
