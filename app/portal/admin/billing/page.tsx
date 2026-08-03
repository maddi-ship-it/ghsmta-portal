import Link from "next/link";

import { formatInvoiceAmount, type SchoolInvoice } from "@/lib/billing/types";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import {
  createAndSendInvoice,
  markInvoicePaid,
  sendInvoiceReminder,
  updateInvoiceOption,
  voidInvoice,
} from "./actions";

type BillingParams = { success?: string; error?: string };

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value))
    : "—";
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<BillingParams>;
}) {
  await requireProfile(["owner"]);
  const params = await searchParams;
  const supabase = await createClient();
  const [cycleResult, optionResult, applicationResult, invoiceResult] = await Promise.all([
    supabase
      .from("award_cycles")
      .select("id,name,season_year,status")
      .neq("status", "archived")
      .order("season_year", { ascending: false }),
    supabase
      .from("cycle_invoice_options")
      .select("id,cycle_id,option_key,label,amount_cents,active,sort_order")
      .order("sort_order"),
    supabase
      .from("applications")
      .select("id,cycle_id,school_name,production_title,applicant_user_id,external_applicant_email")
      .eq("is_archived", false)
      .order("school_name"),
    supabase
      .from("school_invoices")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const cycles = cycleResult.data ?? [];
  const options = optionResult.data ?? [];
  const applications = applicationResult.data ?? [];
  const invoices = (invoiceResult.data ?? []) as SchoolInvoice[];
  const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const applicationMap = new Map(applications.map((application) => [application.id, application]));

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Owner workspace</span>
          <h1>Billing &amp; invoices</h1>
          <p>Set cycle prices, send payment links, record payments, and monitor reminders.</p>
        </div>
      </div>

      {params.success && <div className="notice page-message">{params.success}</div>}
      {params.error && <div className="form-error page-message">{params.error}</div>}

      <div className="billing-layout">
        <section className="panel">
          <div className="panel-header"><div><h2>Send an invoice</h2><p>The school receives email, chat, and an in-app notification.</p></div></div>
          <div className="panel-body">
            <form action={createAndSendInvoice} className="form-stack">
              <div className="field">
                <label htmlFor="billing_application">School</label>
                <select className="select" id="billing_application" name="application_id" required defaultValue="">
                  <option disabled value="">Choose a school</option>
                  {applications.map((application) => (
                    <option key={application.id} value={application.id}>
                      {application.school_name} — {cycleMap.get(application.cycle_id)?.season_year ?? "Cycle"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="billing_option">Track and price</label>
                <select className="select" id="billing_option" name="option_id" required defaultValue="">
                  <option disabled value="">Choose an option</option>
                  {options.filter((option) => option.active).map((option) => (
                    <option key={option.id} value={option.id}>
                      {cycleMap.get(option.cycle_id)?.season_year ?? "Cycle"} · {option.label} · {formatInvoiceAmount(option.amount_cents)}
                    </option>
                  ))}
                </select>
                <small>The selected school and option must be from the same cycle.</small>
              </div>
              <div className="field-grid">
                <div className="field"><label htmlFor="billing_name">Bill to</label><input className="input" id="billing_name" name="billing_name" placeholder="School or district name" required /></div>
                <div className="field"><label htmlFor="recipient_email">Recipient email</label><input className="input" id="recipient_email" name="recipient_email" type="email" required /></div>
              </div>
              <div className="field"><label htmlFor="billing_address">Billing address</label><textarea className="textarea" id="billing_address" name="billing_address" rows={3} /></div>
              <div className="field-grid">
                <div className="field"><label htmlFor="payment_url">Secure payment link</label><input className="input" id="payment_url" name="payment_url" type="url" placeholder="https://…" /><small>Required for invoices above $0.</small></div>
                <div className="field"><label htmlFor="due_date">Due date</label><input className="input" id="due_date" name="due_date" type="date" /><small>Defaults to 30 days.</small></div>
              </div>
              <label className="check-row"><input name="scholarship_confirmation" type="checkbox" />For a $0 option, send a scholarship confirmation instead of a standard invoice</label>
              <button className="button button-primary" type="submit">Create and send</button>
            </form>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2>Cycle pricing</h2><p>Changes apply to new invoices only.</p></div></div>
          <div className="panel-body billing-pricing-list">
            {cycles.map((cycle) => (
              <section className="billing-cycle-prices" key={cycle.id}>
                <h3>{cycle.season_year} · {cycle.name}</h3>
                {options.filter((option) => option.cycle_id === cycle.id).map((option) => (
                  <form action={updateInvoiceOption.bind(null, option.id)} className="billing-price-row" key={option.id}>
                    <input className="input" aria-label="Option label" name="label" defaultValue={option.label} required />
                    <div className="money-input"><span>$</span><input className="input" aria-label="Amount" name="amount" inputMode="decimal" defaultValue={(option.amount_cents / 100).toFixed(2)} required /></div>
                    <label className="check-row"><input defaultChecked={option.active} name="active" type="checkbox" />Active</label>
                    <button className="button button-secondary button-compact" type="submit">Save</button>
                  </form>
                ))}
              </section>
            ))}
          </div>
        </section>
      </div>

      <section className="panel billing-history">
        <div className="panel-header"><div><h2>Invoice history</h2><p>Latest 100 invoices and confirmations.</p></div></div>
        <div className="panel-body table-wrap">
          {invoices.length === 0 ? <p>No invoices have been created.</p> : (
            <table className="data-table">
              <thead><tr><th>Invoice</th><th>School</th><th>Description</th><th>Amount</th><th>Status</th><th>Sent</th><th>Actions</th></tr></thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td><strong>{invoice.invoice_number}</strong><br /><small>{invoice.document_kind.replaceAll("_", " ")}</small></td>
                    <td>{applicationMap.get(invoice.application_id)?.school_name ?? invoice.billing_name}</td>
                    <td>{invoice.description_snapshot}</td>
                    <td>{formatInvoiceAmount(invoice.amount_cents)}</td>
                    <td><span className={`badge invoice-status-${invoice.status}`}>{invoice.status}</span></td>
                    <td>{formatDate(invoice.sent_at)}</td>
                    <td><div className="table-actions">
                      <Link className="button button-secondary button-compact" href={`/portal/invoices/${invoice.id}/pdf`} target="_blank">PDF</Link>
                      {invoice.status === "sent" && invoice.document_kind === "invoice" && (
                        <form action={markInvoicePaid.bind(null, invoice.id)}><button className="button button-primary button-compact" type="submit">Mark paid</button></form>
                      )}
                      {invoice.status === "sent" && invoice.amount_cents > 0 && (
                        <form action={sendInvoiceReminder.bind(null, invoice.id)}><button className="button button-secondary button-compact" type="submit">Remind</button></form>
                      )}
                      {invoice.status !== "paid" && invoice.status !== "void" && <form action={voidInvoice.bind(null, invoice.id)}><button className="button button-ghost button-compact" type="submit">Void</button></form>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
