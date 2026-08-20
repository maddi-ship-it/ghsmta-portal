export type InvoiceEligibilityRow = {
  application_id: string;
  status: "draft" | "sent" | "paid" | "void";
};

export type AcceptdInvoiceEligibilityRow = {
  portal_application_id: string | null;
  mapping_status: string;
};

type AcceptdEligibilityQueryResult = Promise<{
  data: unknown[] | null;
  error: { message: string } | null;
}>;

type AcceptdEligibilityFilteredQuery = AcceptdEligibilityQueryResult & {
  in: (column: string, values: string[]) => AcceptdEligibilityFilteredQuery;
  eq: (column: string, value: string) => AcceptdEligibilityFilteredQuery;
};

type AcceptdEligibilityTableQuery = {
  select: (columns: string) => AcceptdEligibilityFilteredQuery;
};

export const ACCEPTD_INVOICE_ELIGIBILITY_MESSAGE =
  "This school must be synced to an Acceptd application before it can be invoiced.";

const ACCEPTD_ELIGIBILITY_BATCH_SIZE = 500;

export function activeInvoiceApplicationIds(rows: InvoiceEligibilityRow[]) {
  return new Set(
    rows
      .filter((invoice) => invoice.status !== "void")
      .map((invoice) => invoice.application_id),
  );
}

export function syncedAcceptdApplicationIds(
  rows: AcceptdInvoiceEligibilityRow[],
) {
  return new Set(
    rows
      .filter(
        (row) => row.mapping_status === "synced" && row.portal_application_id,
      )
      .map((row) => row.portal_application_id as string),
  );
}

export async function loadInvoiceableAcceptdApplicationIds(
  supabase: {
    from: (table: string) => unknown;
  },
  applicationIds: string[],
) {
  const uniqueApplicationIds = [...new Set(applicationIds.filter(Boolean))];
  if (uniqueApplicationIds.length === 0) return new Set<string>();

  const rows = (
    await Promise.all(
      Array.from(
        {
          length: Math.ceil(
            uniqueApplicationIds.length / ACCEPTD_ELIGIBILITY_BATCH_SIZE,
          ),
        },
        async (_, batchIndex) => {
          const batch = uniqueApplicationIds.slice(
            batchIndex * ACCEPTD_ELIGIBILITY_BATCH_SIZE,
            (batchIndex + 1) * ACCEPTD_ELIGIBILITY_BATCH_SIZE,
          );
          const result = await (
            supabase.from(
              "acceptd_application_snapshots",
            ) as AcceptdEligibilityTableQuery
          )
            .select("portal_application_id,mapping_status")
            .in("portal_application_id", batch)
            .eq("mapping_status", "synced");
          if (result.error) throw new Error(result.error.message);
          return (result.data ?? []) as AcceptdInvoiceEligibilityRow[];
        },
      ),
    )
  ).flat();

  return syncedAcceptdApplicationIds(rows);
}
