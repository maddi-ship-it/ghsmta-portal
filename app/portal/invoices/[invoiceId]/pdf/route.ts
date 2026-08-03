import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createInvoicePdf } from "@/lib/reports/invoice-pdf";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Authentication required.", { status: 401 });

  const { data: invoice, error } = await supabase
    .from("school_invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();
  if (error || !invoice) return new Response("Invoice not found.", { status: 404 });

  const [{ data: application }, { data: cycle }] = await Promise.all([
    supabase
      .from("applications")
      .select("school_name,production_title")
      .eq("id", invoice.application_id)
      .single(),
    supabase
      .from("award_cycles")
      .select("name,season_year")
      .eq("id", invoice.cycle_id)
      .single(),
  ]);
  if (!application || !cycle) {
    return new Response("Invoice context not found.", { status: 404 });
  }

  let logoBytes: Uint8Array | undefined;
  try {
    logoBytes = await readFile(
      join(process.cwd(), "public", "artsbridge-foundation-logo.png"),
    );
  } catch {
    logoBytes = undefined;
  }

  const bytes = await createInvoicePdf(
    {
      ...invoice,
      school_name: application.school_name,
      production_title: application.production_title,
      cycle_name: cycle.name,
      season_year: cycle.season_year,
    },
    logoBytes,
  );
  const fileName = `${invoice.invoice_number}-${invoice.status === "paid" ? "receipt" : "invoice"}.pdf`;
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
