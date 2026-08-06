import Link from "next/link";

import { BillingApplicationAutofill } from "@/components/billing-application-autofill";
import { ConfirmedSubmitButton } from "@/components/confirmed-submit-button";
import { InvoicePreviewSubmitButton } from "@/components/invoice-preview-submit-button";
import {
  DEFAULT_INVOICE_PAYMENT_URL,
  loadBillingApplicationDetails,
} from "@/lib/billing/application-details";
import { activeInvoiceApplicationIds } from "@/lib/billing/eligibility";
import { formatInvoiceAmount, type SchoolInvoice } from "@/lib/billing/types";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import {
  bulkCreateAndSendInvoices,
  bulkUpdateInvoices,
  archiveInvoiceOption,
  createInvoiceOption,
  createAndSendInvoice,
  markInvoicePaid,
  retryInvoiceDelivery,
  sendInvoiceReminder,
  updateInvoiceOption,
  voidInvoice,
} from "./actions";

const INVOICE_STATUS_OPTIONS = ["draft", "sent", "paid", "void"] as const;
const DOCUMENT_KIND_OPTIONS = ["invoice", "scholarship_confirmation"] as const;
const DELIVERY_STATUS_OPTIONS = ["pending", "delivered", "partial", "failed"] as const;

type BillingParams = {
  success?: string;
  error?: string;
  q?: string;
  invoice_status?: string;
  cycle_id?: string;
  document_kind?: string;
  delivery_status?: string;
};

type InvoiceApplicationSummary = {
  id: string;
  school_name: string | null;
  production_title: string | null;
};

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value))
    : "—";
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase();
}

function selectedOption<T extends string>(
  value: string | undefined,
  options: readonly T[],
) {
  return options.includes(value as T) ? (value as T) : "";
}

function displayDocumentKind(kind: SchoolInvoice["document_kind"]) {
  return kind === "scholarship_confirmation"
    ? "Scholarship confirmation"
    : "Invoice";
}

function invoiceMatchesSearch(
  invoice: SchoolInvoice,
  application: InvoiceApplicationSummary | undefined,
  search: string,
) {
  if (!search) return true;
  return [
    invoice.invoice_number,
    invoice.billing_name,
    invoice.billing_contact_name,
    invoice.recipient_email,
    invoice.description_snapshot,
    invoice.payment_promo_code,
    invoice.school_type_snapshot,
    invoice.status,
    invoice.delivery_status,
    displayDocumentKind(invoice.document_kind),
    application?.school_name,
    application?.production_title,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .includes(search);
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<BillingParams>;
}) {
  await requireProfile(["owner"]);
  const params = await searchParams;
  const invoiceSearch = normalizeSearch(params.q ?? "").slice(0, 120);
  const selectedStatus = selectedOption(
    params.invoice_status,
    INVOICE_STATUS_OPTIONS,
  );
  const selectedDocumentKind = selectedOption(
    params.document_kind,
    DOCUMENT_KIND_OPTIONS,
  );
  const selectedDeliveryStatus = selectedOption(
    params.delivery_status,
    DELIVERY_STATUS_OPTIONS,
  );
  const supabase = await createClient();
  const [
    cycleResult,
    optionResult,
    applicationResult,
    invoiceResult,
    activeInvoiceResult,
    deliveryResult,
  ] = await Promise.all([
    supabase
      .from("award_cycles")
      .select("id,name,season_year,status")
      .neq("status", "archived")
      .order("season_year", { ascending: false }),
    supabase
      .from("cycle_invoice_options")
      .select("id,cycle_id,option_key,label,amount_cents,active,sort_order,payment_url,promo_code,archived_at")
      .order("sort_order"),
    supabase
      .from("applications")
      .select("id,cycle_id,school_name,production_title,applicant_user_id,external_applicant_email,form_version_id")
      .eq("is_archived", false)
      .order("school_name"),
    supabase
      .from("school_invoices")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("school_invoices")
      .select("application_id,status"),
    supabase
      .from("invoice_delivery_log")
      .select("invoice_id,email_status,chat_status,detail,created_at")
      .order("created_at", { ascending: false })
      .limit(300),
  ]);
  for (const result of [
    cycleResult,
    optionResult,
    applicationResult,
    invoiceResult,
    activeInvoiceResult,
    deliveryResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }
  const cycles = cycleResult.data ?? [];
  const options = (optionResult.data ?? []).filter((option) => !option.archived_at);
  const applications = applicationResult.data ?? [];
  const invoices = (invoiceResult.data ?? []) as SchoolInvoice[];
  const selectedCycleId = cycles.some((cycle) => cycle.id === params.cycle_id)
    ? params.cycle_id ?? ""
    : "";
  const invoicedApplicationIds = activeInvoiceApplicationIds(
    (activeInvoiceResult.data ?? []) as Array<{
      application_id: string;
      status: "draft" | "sent" | "paid" | "void";
    }>,
  );
  const latestDeliveryByInvoice = new Map<
    string,
    { email_status: string | null; chat_status: string | null; detail: string | null; created_at: string }
  >();
  for (const delivery of deliveryResult.data ?? []) {
    if (!latestDeliveryByInvoice.has(delivery.invoice_id)) {
      latestDeliveryByInvoice.set(delivery.invoice_id, delivery);
    }
  }
  const memberResult = applications.length
    ? await supabase
        .from("application_members")
        .select("application_id,member_role,profiles!application_members_user_id_fkey(email,full_name)")
        .in("application_id", applications.map((application) => application.id))
        .eq("active", true)
    : { data: [], error: null };
  if (memberResult.error) throw new Error(memberResult.error.message);
  const billingDetailsByApplication = await loadBillingApplicationDetails(
    supabase,
    applications,
  );
  const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const applicationMap = new Map(applications.map((application) => [application.id, application]));
  const filteredInvoices = invoices.filter((invoice) => {
    if (selectedStatus && invoice.status !== selectedStatus) return false;
    if (selectedCycleId && invoice.cycle_id !== selectedCycleId) return false;
    if (selectedDocumentKind && invoice.document_kind !== selectedDocumentKind) {
      return false;
    }
    if (
      selectedDeliveryStatus &&
      invoice.delivery_status !== selectedDeliveryStatus
    ) {
      return false;
    }
    return invoiceMatchesSearch(
      invoice,
      applicationMap.get(invoice.application_id),
      invoiceSearch,
    );
  });
  const hasInvoiceFilters = Boolean(
    invoiceSearch ||
      selectedStatus ||
      selectedCycleId ||
      selectedDocumentKind ||
      selectedDeliveryStatus,
  );
  type MemberRow = {
    application_id: string;
    member_role: string;
    profiles:
      | { email: string | null; full_name: string | null }
      | Array<{ email: string | null; full_name: string | null }>
      | null;
  };
  const contactByApplication = new Map<
    string,
    { email: string; name: string | null }
  >();
  ((memberResult.data ?? []) as unknown as MemberRow[])
    .sort((left, right) => Number(right.member_role === "primary") - Number(left.member_role === "primary"))
    .forEach((member) => {
      if (contactByApplication.has(member.application_id)) return;
      const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
      if (profile?.email) {
        contactByApplication.set(member.application_id, {
          email: profile.email,
          name: profile.full_name,
        });
      }
    });

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

      <section className="panel billing-bulk-send">
        <div className="panel-header">
          <div>
            <h2>Bulk send invoices</h2>
            <p>Select one cycle, configure its invoice, and send to as many as 50 school contacts at once.</p>
          </div>
        </div>
        <div className="panel-body billing-bulk-cycle-list">
          {cycles.map((cycle) => {
            const cycleOptions = options.filter(
              (option) => option.cycle_id === cycle.id && option.active,
            );
            const allCycleApplications = applications.filter(
              (application) => application.cycle_id === cycle.id,
            );
            const cycleApplications = allCycleApplications.filter(
              (application) => !invoicedApplicationIds.has(application.id),
            );
            const alreadyInvoicedCount =
              allCycleApplications.length - cycleApplications.length;
            return (
              <details className="billing-bulk-cycle" key={cycle.id} open={cycles.length === 1}>
                <summary>
                  <span>
                    <strong>{cycle.season_year} · {cycle.name}</strong>
                    <small>
                      {cycleApplications.length} ready to invoice
                      {alreadyInvoicedCount > 0
                        ? ` · ${alreadyInvoicedCount} already sent or paid`
                        : ""}
                    </small>
                  </span>
                  <span aria-hidden="true">⌄</span>
                </summary>
                <form action={bulkCreateAndSendInvoices} className="form-stack billing-bulk-form">
                  <div className="field-grid">
                    <div className="field">
                      <label htmlFor={`bulk_option_${cycle.id}`}>Track and price</label>
                      <select className="select" defaultValue="" id={`bulk_option_${cycle.id}`} name="option_id" required>
                        <option disabled value="">Choose an option</option>
                        {cycleOptions.map((option) => (
                          <option
                            data-amount-cents={option.amount_cents}
                            data-label={option.label}
                            key={option.id}
                            value={option.id}
                          >
                            {option.label} · {formatInvoiceAmount(option.amount_cents)}
                            {option.promo_code ? ` · code ${option.promo_code}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`bulk_due_${cycle.id}`}>Due date</label>
                      <input className="input" id={`bulk_due_${cycle.id}`} name="due_date" type="date" />
                      <small>Defaults to 30 days for paid invoices.</small>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor={`bulk_payment_${cycle.id}`}>Secure payment link</label>
                    <input className="input" defaultValue={DEFAULT_INVOICE_PAYMENT_URL} id={`bulk_payment_${cycle.id}`} name="payment_url" placeholder="https://…" type="url" />
                    <small>Each payment amount can also store its own default link and promo code.</small>
                  </div>
                  <label className="check-row"><input name="scholarship_confirmation" type="checkbox" />For a $0 option, send scholarship confirmations</label>
                  <fieldset className="billing-school-picker">
                    <legend>Schools</legend>
                    <div className="billing-school-grid">
                      {cycleApplications.length === 0 ? (
                        <div className="empty-state billing-school-empty">
                          <h3>Every school has an active invoice</h3>
                          <p>Void an invoice to return that school to this list.</p>
                        </div>
                      ) : cycleApplications.map((application) => {
                        const contact = contactByApplication.get(application.id);
                        const recipientEmail = contact?.email ?? application.external_applicant_email;
                        const billingDetails = billingDetailsByApplication.get(application.id);
                        const schoolType = billingDetails?.schoolType ?? "School type missing";
                        const selectedTrack = billingDetails?.selectedTrack ?? "Track missing";
                        return (
                          <label className={`billing-school-choice${recipientEmail ? "" : " is-disabled"}`} key={application.id}>
                            <input
                              data-school-name={application.school_name}
                              data-selected-track={billingDetails?.selectedTrack ?? ""}
                              data-school-type={billingDetails?.schoolType ?? ""}
                              disabled={!recipientEmail}
                              name="application_ids"
                              type="checkbox"
                              value={application.id}
                            />
                            <span>
                              <strong>{application.school_name}</strong>
                              <small>
                                {schoolType} · {selectedTrack} ·{" "}
                                {recipientEmail ?? "Missing school contact email"}
                              </small>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  <InvoicePreviewSubmitButton bulk />
                </form>
              </details>
            );
          })}
        </div>
      </section>

      <div className="billing-stack">
        <details className="panel billing-collapsible-panel" open>
          <summary className="panel-header billing-collapsible-summary">
            <div>
              <h2>Send an invoice</h2>
              <p>The school receives email, School Messaging, and an in-app notification. Invoice notices never enter Panel Channels.</p>
            </div>
            <span aria-hidden="true">⌄</span>
          </summary>
          <div className="panel-body">
            <form action={createAndSendInvoice} className="form-stack">
              <div className="field">
                <label htmlFor="billing_application">School</label>
                <select className="select" id="billing_application" name="application_id" required defaultValue="">
                  <option disabled value="">Choose a school</option>
                  {applications.map((application) => {
                    const contact = contactByApplication.get(application.id);
                    const billingDetails = billingDetailsByApplication.get(application.id);
                    const schoolType =
                      billingDetails?.schoolType ?? "School type missing";
                    const selectedTrack =
                      billingDetails?.selectedTrack ?? "Track missing";
                    const recipientEmail =
                      contact?.email ?? application.external_applicant_email ?? "";
                    return (
                      <option
                        data-billing-address={billingDetails?.schoolAddress ?? ""}
                        data-billing-contact-name={contact?.name ?? ""}
                        data-billing-contact-phone={billingDetails?.schoolPhone ?? ""}
                        data-recipient-email={recipientEmail}
                        data-school-name={application.school_name}
                        data-school-type={billingDetails?.schoolType ?? ""}
                        data-selected-track={billingDetails?.selectedTrack ?? ""}
                        key={application.id}
                        value={application.id}
                      >
                        {application.school_name} · {schoolType} · {selectedTrack} —{" "}
                        {cycleMap.get(application.cycle_id)?.season_year ?? "Cycle"}
                      </option>
                    );
                  })}
                </select>
                <BillingApplicationAutofill />
              </div>
              <div className="field">
                <label htmlFor="billing_option">Track and price</label>
                <select className="select" id="billing_option" name="option_id" required defaultValue="">
                  <option disabled value="">Choose an option</option>
                  {options.filter((option) => option.active).map((option) => (
                    <option
                      data-amount-cents={option.amount_cents}
                      data-label={option.label}
                      key={option.id}
                      value={option.id}
                    >
                      {cycleMap.get(option.cycle_id)?.season_year ?? "Cycle"} · {option.label} · {formatInvoiceAmount(option.amount_cents)}
                      {option.promo_code ? ` · code ${option.promo_code}` : ""}
                    </option>
                  ))}
                </select>
                <small>The selected school and option must be from the same cycle.</small>
              </div>
              <div className="field-grid">
                <div className="field"><label htmlFor="billing_name">Bill to override</label><input className="input" id="billing_name" name="billing_name" placeholder="Defaults to the school name" /></div>
                <div className="field"><label htmlFor="recipient_email">Billing email override</label><input className="input" id="recipient_email" name="recipient_email" type="email" required /></div>
              </div>
              <div className="field-grid">
                <div className="field"><label htmlFor="billing_contact_name">Billing contact name override</label><input className="input" id="billing_contact_name" name="billing_contact_name" placeholder="Optional" /></div>
                <div className="field"><label htmlFor="billing_contact_phone">Billing phone override</label><input className="input" id="billing_contact_phone" name="billing_contact_phone" placeholder="Defaults to Acceptd school phone" /></div>
              </div>
              <div className="field"><label htmlFor="billing_address">Billing address override</label><textarea className="textarea" id="billing_address" name="billing_address" placeholder="Defaults to the Acceptd school address when available." rows={3} /></div>
              <div className="field-grid">
                <div className="field"><label htmlFor="payment_url">Secure payment link override</label><input className="input" defaultValue={DEFAULT_INVOICE_PAYMENT_URL} id="payment_url" name="payment_url" type="url" placeholder="https://…" /><small>Defaults to the selected amount’s link, then the Qgiv link.</small></div>
                <div className="field"><label htmlFor="due_date">Due date</label><input className="input" id="due_date" name="due_date" type="date" /><small>Defaults to 30 days.</small></div>
              </div>
              <label className="check-row"><input name="scholarship_confirmation" type="checkbox" />For a $0 option, send a scholarship confirmation instead of a standard invoice</label>
              <InvoicePreviewSubmitButton />
            </form>
          </div>
        </details>

        <details className="panel billing-collapsible-panel">
          <summary className="panel-header billing-collapsible-summary">
            <div>
              <h2>Cycle pricing</h2>
              <p>Changes apply to new invoices only.</p>
            </div>
            <span aria-hidden="true">⌄</span>
          </summary>
          <div className="panel-body billing-pricing-list">
            {cycles.map((cycle) => (
              <section className="billing-cycle-prices" key={cycle.id}>
                <h3>{cycle.season_year} · {cycle.name}</h3>
                {options.filter((option) => option.cycle_id === cycle.id).map((option) => (
                  <form action={updateInvoiceOption.bind(null, option.id)} className="billing-price-row" key={option.id}>
                    <input className="input" aria-label="Option label" name="label" defaultValue={option.label} required />
                    <div className="money-input"><span>$</span><input className="input" aria-label="Amount" name="amount" inputMode="decimal" defaultValue={(option.amount_cents / 100).toFixed(2)} required /></div>
                    <input className="input" aria-label="Promo code" name="promo_code" defaultValue={option.promo_code ?? ""} placeholder="Promo code" />
                    <input className="input" aria-label="Payment link" name="payment_url" defaultValue={option.payment_url ?? DEFAULT_INVOICE_PAYMENT_URL} placeholder="https://…" type="url" />
                    <label className="check-row"><input defaultChecked={option.active} name="active" type="checkbox" />Active</label>
                    <button className="button button-secondary button-compact" type="submit">Save</button>
                  </form>
                ))}
                <form action={createInvoiceOption} className="billing-price-row billing-price-row-new">
                  <input name="cycle_id" type="hidden" value={cycle.id} />
                  <input className="input" aria-label="New payment label" name="label" placeholder="New payment amount label" required />
                  <div className="money-input"><span>$</span><input className="input" aria-label="New amount" name="amount" inputMode="decimal" placeholder="0.00" required /></div>
                  <input className="input" aria-label="New promo code" name="promo_code" placeholder="Promo code" />
                  <input className="input" aria-label="New payment link" name="payment_url" defaultValue={DEFAULT_INVOICE_PAYMENT_URL} placeholder="https://…" type="url" />
                  <span />
                  <button className="button button-primary button-compact" type="submit">Add amount</button>
                </form>
                {options.filter((option) => option.cycle_id === cycle.id).map((option) => (
                  <form action={archiveInvoiceOption.bind(null, option.id)} className="billing-archive-row" key={`${option.id}-archive`}>
                    <small>Archive {option.label} when it should no longer appear for new invoices.</small>
                    <ConfirmedSubmitButton className="button button-ghost button-compact" description="Archived payment amounts are hidden for new invoices, but existing invoice history stays intact." destructive label="Archive" title="Archive this payment amount?" />
                  </form>
                ))}
              </section>
            ))}
          </div>
        </details>
      </div>

      <section className="panel billing-history">
        <div className="panel-header">
          <div>
            <h2>Invoice history</h2>
            <p>
              Showing {filteredInvoices.length} of {invoices.length} latest invoices
              and confirmations.
            </p>
          </div>
        </div>
        <div className="panel-body billing-history-body">
          {invoices.length === 0 ? <p>No invoices have been created.</p> : (
            <>
              <form className="billing-history-filters" method="get">
                <div className="field billing-history-search">
                  <label htmlFor="invoice_history_search">Search invoices</label>
                  <input
                    className="input"
                    defaultValue={params.q ?? ""}
                    id="invoice_history_search"
                    name="q"
                    placeholder="School, invoice #, email, description, promo code"
                    type="search"
                  />
                </div>
                <div className="field">
                  <label htmlFor="invoice_history_status">Status</label>
                  <select
                    className="select"
                    defaultValue={selectedStatus}
                    id="invoice_history_status"
                    name="invoice_status"
                  >
                    <option value="">All statuses</option>
                    <option value="sent">Sent</option>
                    <option value="paid">Paid</option>
                    <option value="void">Void</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="invoice_history_cycle">Cycle</label>
                  <select
                    className="select"
                    defaultValue={selectedCycleId}
                    id="invoice_history_cycle"
                    name="cycle_id"
                  >
                    <option value="">All cycles</option>
                    {cycles.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {cycle.season_year} · {cycle.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="invoice_history_kind">Type</label>
                  <select
                    className="select"
                    defaultValue={selectedDocumentKind}
                    id="invoice_history_kind"
                    name="document_kind"
                  >
                    <option value="">All types</option>
                    <option value="invoice">Invoices</option>
                    <option value="scholarship_confirmation">
                      Scholarship confirmations
                    </option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="invoice_history_delivery">Delivery</label>
                  <select
                    className="select"
                    defaultValue={selectedDeliveryStatus}
                    id="invoice_history_delivery"
                    name="delivery_status"
                  >
                    <option value="">All delivery</option>
                    <option value="pending">Pending</option>
                    <option value="delivered">Delivered</option>
                    <option value="partial">Partial</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
                <button className="button button-dark billing-history-filter-submit" type="submit">
                  Apply filters
                </button>
                {hasInvoiceFilters ? (
                  <Link className="button button-secondary" href="/portal/admin/billing">
                    Clear filters
                  </Link>
                ) : null}
              </form>
              {filteredInvoices.length === 0 ? (
                <div className="empty-state compact-empty-state">
                  <h3>No invoices match these filters.</h3>
                  <p>Try a broader search or clear one of the filters.</p>
                  <Link className="button button-secondary" href="/portal/admin/billing">
                    Clear filters
                  </Link>
                </div>
              ) : (
                <>
              <form action={bulkUpdateInvoices} className="billing-bulk-toolbar" id="billing-bulk-actions">
                <strong>Update selected</strong>
                <select aria-label="Bulk invoice action" className="select" defaultValue="" name="operation" required>
                  <option disabled value="">Choose action</option>
                  <option value="mark_paid">Mark paid and send receipts</option>
                  <option value="remind">Send payment reminders</option>
                  <option value="resend">Resend invoice documents</option>
                  <option value="void">Void invoices</option>
                </select>
                <input className="input input-compact" name="void_reason" placeholder="Reason (required only when voiding)" />
                <ConfirmedSubmitButton
                  description="The selected action will apply to every checked invoice that is eligible."
                  label="Apply selected action"
                  title="Update the selected invoices?"
                />
              </form>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th><span className="sr-only">Select</span></th><th>Invoice</th><th>School</th><th>Description</th><th>Amount</th><th>Status</th><th>Delivery</th><th>Sent</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredInvoices.map((invoice) => {
                      const latestDelivery = latestDeliveryByInvoice.get(invoice.id);
                      return (
                      <tr key={invoice.id}>
                        <td><input aria-label={`Select invoice ${invoice.invoice_number}`} form="billing-bulk-actions" name="invoice_ids" type="checkbox" value={invoice.id} /></td>
                        <td><strong>{invoice.invoice_number}</strong><br /><small>{displayDocumentKind(invoice.document_kind)}</small></td>
                        <td>{applicationMap.get(invoice.application_id)?.school_name ?? invoice.billing_name}</td>
                        <td>{invoice.description_snapshot}</td>
                        <td>{formatInvoiceAmount(invoice.amount_cents)}</td>
                        <td><span className={`badge invoice-status-${invoice.status}`}>{invoice.status}</span></td>
                        <td>
                          <span className={`badge invoice-delivery-${invoice.delivery_status ?? "pending"}`}>
                            {invoice.delivery_status ?? "pending"}
                          </span>
                          {latestDelivery ? (
                            <small className="invoice-delivery-detail">
                              Email: {latestDelivery.email_status ?? "—"} · Chat: {latestDelivery.chat_status ?? "—"}
                            </small>
                          ) : null}
                        </td>
                        <td>{formatDate(invoice.sent_at)}</td>
                        <td><div className="table-actions">
                          <Link className="button button-secondary button-compact" href={`/portal/invoices/${invoice.id}/pdf`} target="_blank">PDF</Link>
                          {invoice.status === "sent" && invoice.document_kind === "invoice" && (
                            <form action={markInvoicePaid.bind(null, invoice.id)}>
                              <ConfirmedSubmitButton className="button button-primary button-compact" description="This records payment and immediately sends the school a receipt." label="Mark paid" title="Record this payment?" />
                            </form>
                          )}
                          {invoice.status === "sent" && invoice.amount_cents > 0 && (
                            <form action={sendInvoiceReminder.bind(null, invoice.id)}>
                              <ConfirmedSubmitButton className="button button-secondary button-compact" description="A payment reminder will be sent by email and private School Messaging." label="Remind" title="Send a payment reminder?" />
                            </form>
                          )}
                          {invoice.status !== "void" ? (
                            <form action={retryInvoiceDelivery.bind(null, invoice.id)}>
                              <ConfirmedSubmitButton className="button button-secondary button-compact" description="The current invoice, receipt, or scholarship confirmation will be sent again by email and private School Messaging." label={invoice.delivery_status === "failed" || invoice.delivery_status === "partial" ? "Retry" : "Resend"} title="Resend this document?" />
                            </form>
                          ) : null}
                          {invoice.status !== "paid" && invoice.status !== "void" && (
                            <form action={voidInvoice.bind(null, invoice.id)}>
                              <ConfirmedSubmitButton className="button button-ghost button-compact" description="This stops reminders and preserves the invoice in the financial audit history." destructive label="Void" requireReason title="Void this invoice?" />
                            </form>
                          )}
                        </div></td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
                </>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
