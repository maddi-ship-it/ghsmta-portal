import Link from "next/link";

import { formatInvoiceAmount, type SchoolInvoice } from "@/lib/billing/types";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function InvoicesPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("school_invoices")
    .select("*")
    .order("created_at", { ascending: false });
  const invoices = (data ?? []) as SchoolInvoice[];

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">School billing</span>
          <h1>Invoices &amp; payments</h1>
          <p>View invoices, open secure payment links, and download receipts or scholarship confirmations.</p>
        </div>
        {profile.role === "owner" && <Link className="button button-primary" href="/portal/admin/billing">Open Owner billing</Link>}
      </div>
      {error && <div className="form-error page-message">{error.message}</div>}
      <div className="invoice-card-grid">
        {invoices.length === 0 ? (
          <section className="panel"><div className="panel-body"><h2>No invoices yet</h2><p>New invoices and confirmations will appear here after an Owner sends them.</p></div></section>
        ) : invoices.map((invoice) => (
          <article className="panel invoice-card" key={invoice.id}>
            <div className="panel-body">
              <div className="invoice-card-heading"><div><span className="eyebrow">{invoice.document_kind.replaceAll("_", " ")}</span><h2>{invoice.invoice_number}</h2></div><span className={`badge invoice-status-${invoice.status}`}>{invoice.status}</span></div>
              <p>{invoice.description_snapshot}</p>
              <strong className="invoice-card-amount">{formatInvoiceAmount(invoice.amount_cents)}</strong>
              {invoice.due_at && invoice.status === "sent" && <small>Due {new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(invoice.due_at))}</small>}
              <div className="heading-actions">
                {invoice.status === "sent" && invoice.payment_url && <Link className="button button-primary" href={invoice.payment_url} target="_blank" rel="noreferrer">Pay securely</Link>}
                <Link className="button button-secondary" href={`/portal/invoices/${invoice.id}/pdf`} target="_blank">{invoice.status === "paid" ? "View receipt" : "View PDF"}</Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
