import { ConfirmedSubmitButton } from "@/components/confirmed-submit-button";
import { OperationsExportMenu } from "@/components/operations-export-menu";
import { createClient } from "@/lib/supabase/server";

import {
  createContractPayment,
  createOperationsContract,
  deleteContractPayment,
  deleteOperationsContract,
  updateContractPayment,
  updateOperationsContract,
} from "./actions";

type SearchParams = {
  production?: string;
  status?: string;
  q?: string;
};

type Production = { id: string; name: string };
type BudgetLine = {
  id: string;
  production_id: string;
  gl_code: string;
  department: string | null;
};
type Contract = {
  id: string;
  production_id: string | null;
  contractor_profile_id: string | null;
  contract_number: string | null;
  contract_type: string;
  status: string;
  contractor_name: string;
  contractor_email: string;
  contractor_phone: string | null;
  contractor_address: string | null;
  role_title: string;
  foundation_signer_name: string | null;
  agreement_date: string | null;
  starts_on: string | null;
  ends_on: string | null;
  event_date: string | null;
  total_consideration: number;
  responsibilities: string | null;
  transportation: string | null;
  lodging: string | null;
  meals: string | null;
  out_of_pocket_expenses: string | null;
  communication_credit: string | null;
  contract_document_url: string | null;
  signed_document_url: string | null;
  w9_document_url: string | null;
  w9_received: boolean;
  contractor_signed_at: string | null;
  foundation_signed_at: string | null;
  internal_notes: string | null;
};
type Payment = {
  id: string;
  contract_id: string;
  installment_order: number;
  label: string;
  deliverable: string | null;
  amount: number;
  due_date: string | null;
  status: string;
  budget_line_id: string | null;
  invoice_received_at: string | null;
  paid_at: string | null;
  notes: string | null;
};

const contractStatuses = [
  "draft",
  "preparing",
  "sent",
  "partially_signed",
  "executed",
  "active",
  "complete",
  "terminated",
  "cancelled",
  "archived",
];
const paymentStatuses = [
  "scheduled",
  "invoice_requested",
  "invoiced",
  "approved",
  "paid",
  "held",
  "cancelled",
];

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}

function date(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function dateInput(value: string | null) {
  return value?.slice(0, 10) ?? "";
}

function ContractFields({
  contract,
  productions,
  prefix,
}: {
  contract?: Contract;
  productions: Production[];
  prefix: string;
}) {
  return (
    <>
      <div className="field"><label htmlFor={`${prefix}-number`}>Contract number</label><input className="input" defaultValue={contract?.contract_number ?? ""} id={`${prefix}-number`} name="contract_number" placeholder="GHSMTA-26-001" /></div>
      <div className="field"><label htmlFor={`${prefix}-status`}>Status</label><select className="select" defaultValue={contract?.status ?? "draft"} id={`${prefix}-status`} name="status">{contractStatuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></div>
      <div className="field"><label htmlFor={`${prefix}-production`}>Production</label><select className="select" defaultValue={contract?.production_id ?? ""} id={`${prefix}-production`} name="production_id"><option value="">General GHSMTA</option>{productions.map((production) => <option key={production.id} value={production.id}>{production.name}</option>)}</select></div>
      <div className="field"><label htmlFor={`${prefix}-type`}>Agreement type</label><input className="input" defaultValue={contract?.contract_type ?? "work_for_hire"} id={`${prefix}-type`} name="contract_type" /></div>

      <div className="field"><label htmlFor={`${prefix}-name`}>Contractor name</label><input className="input" defaultValue={contract?.contractor_name ?? ""} id={`${prefix}-name`} name="contractor_name" required /></div>
      <div className="field"><label htmlFor={`${prefix}-email`}>Contractor email</label><input className="input" defaultValue={contract?.contractor_email ?? ""} id={`${prefix}-email`} name="contractor_email" type="email" required /><small>Links the existing portal account or creates a PRODUCTION account and adds it to the PRODUCTION chat.</small></div>
      <div className="field"><label htmlFor={`${prefix}-phone`}>Contractor phone</label><input className="input" defaultValue={contract?.contractor_phone ?? ""} id={`${prefix}-phone`} name="contractor_phone" type="tel" /></div>
      <div className="field"><label htmlFor={`${prefix}-role`}>Contract role</label><input className="input" defaultValue={contract?.role_title ?? ""} id={`${prefix}-role`} name="role_title" placeholder="Production Manager" required /></div>
      <div className="field field-span-2"><label htmlFor={`${prefix}-address`}>Contractor address</label><textarea className="textarea" defaultValue={contract?.contractor_address ?? ""} id={`${prefix}-address`} name="contractor_address" rows={2} /></div>

      <div className="field"><label htmlFor={`${prefix}-agreement-date`}>Agreement date</label><input className="input" defaultValue={contract?.agreement_date ?? ""} id={`${prefix}-agreement-date`} name="agreement_date" type="date" /></div>
      <div className="field"><label htmlFor={`${prefix}-event-date`}>GHSMTA event date</label><input className="input" defaultValue={contract?.event_date ?? ""} id={`${prefix}-event-date`} name="event_date" type="date" /></div>
      <div className="field"><label htmlFor={`${prefix}-starts`}>Term starts</label><input className="input" defaultValue={contract?.starts_on ?? ""} id={`${prefix}-starts`} name="starts_on" type="date" /></div>
      <div className="field"><label htmlFor={`${prefix}-ends`}>Term ends</label><input className="input" defaultValue={contract?.ends_on ?? ""} id={`${prefix}-ends`} name="ends_on" type="date" /></div>
      <div className="field"><label htmlFor={`${prefix}-value`}>Total consideration</label><input className="input" defaultValue={contract?.total_consideration ?? 0} id={`${prefix}-value`} min="0" name="total_consideration" step="0.01" type="number" /></div>
      <div className="field"><label htmlFor={`${prefix}-signer`}>Foundation signer</label><input className="input" defaultValue={contract?.foundation_signer_name ?? ""} id={`${prefix}-signer`} name="foundation_signer_name" /></div>

      <div className="field field-span-2"><label htmlFor={`${prefix}-responsibilities`}>Schedule A responsibilities</label><textarea className="textarea" defaultValue={contract?.responsibilities ?? ""} id={`${prefix}-responsibilities`} name="responsibilities" rows={7} /></div>
      <div className="field"><label htmlFor={`${prefix}-transportation`}>Transportation</label><textarea className="textarea" defaultValue={contract?.transportation ?? ""} id={`${prefix}-transportation`} name="transportation" rows={3} /></div>
      <div className="field"><label htmlFor={`${prefix}-lodging`}>Lodging</label><textarea className="textarea" defaultValue={contract?.lodging ?? ""} id={`${prefix}-lodging`} name="lodging" rows={3} /></div>
      <div className="field"><label htmlFor={`${prefix}-meals`}>Meals</label><textarea className="textarea" defaultValue={contract?.meals ?? ""} id={`${prefix}-meals`} name="meals" rows={3} /></div>
      <div className="field"><label htmlFor={`${prefix}-expenses`}>Out-of-pocket expenses</label><textarea className="textarea" defaultValue={contract?.out_of_pocket_expenses ?? ""} id={`${prefix}-expenses`} name="out_of_pocket_expenses" rows={3} /></div>
      <div className="field field-span-2"><label htmlFor={`${prefix}-credit`}>Communication of credit</label><input className="input" defaultValue={contract?.communication_credit ?? ""} id={`${prefix}-credit`} name="communication_credit" /></div>

      <div className="field"><label htmlFor={`${prefix}-contract-url`}>Working contract link</label><input className="input" defaultValue={contract?.contract_document_url ?? ""} id={`${prefix}-contract-url`} name="contract_document_url" type="url" /></div>
      <div className="field"><label htmlFor={`${prefix}-signed-url`}>Signed contract link</label><input className="input" defaultValue={contract?.signed_document_url ?? ""} id={`${prefix}-signed-url`} name="signed_document_url" type="url" /></div>
      <div className="field"><label htmlFor={`${prefix}-w9-url`}>W-9 link</label><input className="input" defaultValue={contract?.w9_document_url ?? ""} id={`${prefix}-w9-url`} name="w9_document_url" type="url" /></div>
      <div className="field operations-check-row"><label><input defaultChecked={contract?.w9_received ?? false} name="w9_received" type="checkbox" /> W-9 received</label></div>
      <div className="field"><label htmlFor={`${prefix}-contractor-signed`}>Contractor signed</label><input className="input" defaultValue={dateInput(contract?.contractor_signed_at ?? null)} id={`${prefix}-contractor-signed`} name="contractor_signed_on" type="date" /></div>
      <div className="field"><label htmlFor={`${prefix}-foundation-signed`}>Foundation signed</label><input className="input" defaultValue={dateInput(contract?.foundation_signed_at ?? null)} id={`${prefix}-foundation-signed`} name="foundation_signed_on" type="date" /></div>
      <div className="field field-span-2"><label htmlFor={`${prefix}-notes`}>Owner notes</label><textarea className="textarea" defaultValue={contract?.internal_notes ?? ""} id={`${prefix}-notes`} name="internal_notes" rows={3} /></div>
    </>
  );
}

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = await searchParams;
  const supabase = await createClient();
  let contractQuery = supabase
    .from("ghsmta_operations_contracts")
    .select("id,production_id,contractor_profile_id,contract_number,contract_type,status,contractor_name,contractor_email,contractor_phone,contractor_address,role_title,foundation_signer_name,agreement_date,starts_on,ends_on,event_date,total_consideration,responsibilities,transportation,lodging,meals,out_of_pocket_expenses,communication_credit,contract_document_url,signed_document_url,w9_document_url,w9_received,contractor_signed_at,foundation_signed_at,internal_notes")
    .order("starts_on", { ascending: false, nullsFirst: false })
    .order("contractor_name");

  if (filters.production) contractQuery = contractQuery.eq("production_id", filters.production);
  if (filters.status) contractQuery = contractQuery.eq("status", filters.status);
  if (filters.q?.trim()) {
    const query = filters.q.trim().replace(/[^a-zA-Z0-9@._' -]/g, "");
    contractQuery = contractQuery.or(
      `contractor_name.ilike.%${query}%,contractor_email.ilike.%${query}%,role_title.ilike.%${query}%,contract_number.ilike.%${query}%`,
    );
  }

  const [contractsResult, paymentsResult, productionsResult, budgetLinesResult] = await Promise.all([
    contractQuery,
    supabase
      .from("ghsmta_operations_contract_payments")
      .select("id,contract_id,installment_order,label,deliverable,amount,due_date,status,budget_line_id,invoice_received_at,paid_at,notes")
      .order("installment_order")
      .order("due_date", { nullsFirst: false }),
    supabase
      .from("ghsmta_operations_productions")
      .select("id,name")
      .order("name"),
    supabase
      .from("ghsmta_operations_budget_lines")
      .select("id,production_id,gl_code,department")
      .order("gl_code"),
  ]);

  const loadError = contractsResult.error || paymentsResult.error || productionsResult.error || budgetLinesResult.error;
  if (loadError) throw new Error(loadError.message);

  const contracts = (contractsResult.data ?? []) as Contract[];
  const allPayments = (paymentsResult.data ?? []) as Payment[];
  const productions = (productionsResult.data ?? []) as Production[];
  const budgetLines = (budgetLinesResult.data ?? []) as BudgetLine[];
  const productionNames = new Map(productions.map((item) => [item.id, item.name]));
  const budgetLinesByProduction = new Map<string, BudgetLine[]>();
  budgetLines.forEach((budgetLine) => {
    const rows = budgetLinesByProduction.get(budgetLine.production_id) ?? [];
    rows.push(budgetLine);
    budgetLinesByProduction.set(budgetLine.production_id, rows);
  });
  const paymentsByContract = new Map<string, Payment[]>();
  allPayments.forEach((payment) => {
    const rows = paymentsByContract.get(payment.contract_id) ?? [];
    rows.push(payment);
    paymentsByContract.set(payment.contract_id, rows);
  });

  const activeContracts = contracts.filter((contract) =>
    ["executed", "active"].includes(contract.status),
  ).length;
  const awaitingSignatures = contracts.filter((contract) =>
    ["sent", "partially_signed"].includes(contract.status),
  ).length;
  const totalValue = contracts.reduce(
    (sum, contract) => sum + Number(contract.total_consideration || 0),
    0,
  );
  const totalPaid = allPayments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  return (
    <div className="operations-stack">
      <section className="operations-section-heading">
        <div><span className="eyebrow">Agreements and payment tracking</span><h2>Contracts</h2><p>Manage GHSMTA contractor terms, signatures, W-9s, documents, and installment payments. Contract documents retain the supplied ArtsBridge format.</p></div>
      </section>

      <OperationsExportMenu
        options={[
          { label: "Contract Register PDF", module: "contracts", format: "pdf", query: filters },
          { label: "Contract Register CSV", module: "contracts", format: "csv", query: filters },
          { label: "Payment Schedule PDF", module: "contracts", format: "pdf", variant: "payments", query: filters },
          { label: "Payment Schedule CSV", module: "contracts", format: "csv", variant: "payments", query: filters },
        ]}
        description="Download the owner contract register or the complete payment schedule."
      />

      <section className="operations-summary-grid" aria-label="Contract summary">
        <article><span>Contracts</span><strong>{contracts.length}</strong><small>Matching the current filters</small></article>
        <article><span>Awaiting signatures</span><strong>{awaitingSignatures}</strong><small>Sent or partially signed</small></article>
        <article><span>Executed / active</span><strong>{activeContracts}</strong><small>Ready or currently in term</small></article>
        <article><span>Value / paid</span><strong>{money(totalValue)}</strong><small>{money(totalPaid)} marked paid</small></article>
      </section>

      <details className="panel operations-create-panel" open={contracts.length === 0}>
        <summary><span><strong>Add a contract</strong><small>Create the tracking record, link or invite the contractor, and add them to the private PRODUCTION chat.</small></span><span aria-hidden="true">＋</span></summary>
        <form action={createOperationsContract} className="operations-form-grid panel-body">
          <ContractFields prefix="new-contract" productions={productions} />
          <div className="operations-form-actions field-span-2"><button className="button button-primary" type="submit">Create contract and provision access</button></div>
        </form>
      </details>

      <form className="panel operations-filter-bar operations-contract-filter" method="get">
        <div className="field"><label htmlFor="contract-search">Search</label><input className="input" defaultValue={filters.q ?? ""} id="contract-search" name="q" placeholder="Contractor, role, email, or number" /></div>
        <div className="field"><label htmlFor="contract-production">Production</label><select className="select" defaultValue={filters.production ?? ""} id="contract-production" name="production"><option value="">All productions</option>{productions.map((production) => <option key={production.id} value={production.id}>{production.name}</option>)}</select></div>
        <div className="field"><label htmlFor="contract-status">Status</label><select className="select" defaultValue={filters.status ?? ""} id="contract-status" name="status"><option value="">All statuses</option>{contractStatuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></div>
        <div className="operations-filter-actions"><button className="button button-dark button-compact" type="submit">Apply filters</button><a className="button button-secondary button-compact" href="/portal/admin/operations/contracts">Clear</a></div>
      </form>

      <section className="panel">
        <div className="panel-header"><div><span className="eyebrow">Owner contract register</span><h2>GHSMTA agreements</h2></div><span className="badge">{contracts.length} shown</span></div>
        <div className="operations-card-list panel-body">
          {contracts.length === 0 ? (
            <div className="operations-empty"><strong>No contracts match these filters.</strong><p>Create a contract or clear the current filters.</p></div>
          ) : contracts.map((contract) => {
            const payments = paymentsByContract.get(contract.id) ?? [];
            const contractBudgetLines = contract.production_id
              ? budgetLinesByProduction.get(contract.production_id) ?? []
              : [];
            const linkedPaymentCount = payments.filter((payment) => payment.budget_line_id).length;
            const scheduled = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
            const paid = payments.filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
            const signatureState = contract.contractor_signed_at && contract.foundation_signed_at ? "Fully signed" : contract.contractor_signed_at || contract.foundation_signed_at ? "Partially signed" : "Not signed";
            return (
              <details className="operations-record operations-contract-record" key={contract.id}>
                <summary>
                  <div><span className={`badge badge-${contract.status}`}>{label(contract.status)}</span><strong>{contract.contractor_name} · {contract.role_title}</strong><small>{[contract.contract_number, productionNames.get(contract.production_id ?? "") ?? "General GHSMTA", `${date(contract.starts_on)}–${date(contract.ends_on)}`, signatureState].filter(Boolean).join(" · ")}</small></div>
                  <span className="operations-record-action">Open contract</span>
                </summary>

                <div className="operations-contract-overview">
                  <span><small>Contract value</small><strong>{money(Number(contract.total_consideration))}</strong></span>
                  <span><small>Payments scheduled</small><strong>{money(scheduled)}</strong></span>
                  <span><small>Paid</small><strong>{money(paid)}</strong></span>
                  <span><small>W-9</small><strong>{contract.w9_received ? "Received" : "Outstanding"}</strong></span>
                  <span><small>Portal</small><strong>{contract.contractor_profile_id ? "Linked" : "Not linked"}</strong></span>
                </div>

                <div className="operations-contract-documents">
                  <div><strong>Documents</strong><small>The generated Word and PDF agreements use the supplied GHSMTA contract structure without redesigning it.</small></div>
                  <div><a className="button button-primary button-compact" href={`/api/admin/operations/contracts/${contract.id}/document`}>Generate contract DOCX</a><a className="button button-secondary button-compact" href={`/api/admin/operations/contracts/${contract.id}/pdf`}>Generate contract PDF</a>{contract.contract_document_url ? <a className="button button-secondary button-compact" href={contract.contract_document_url} rel="noreferrer" target="_blank">Open working contract</a> : <span>Working contract not linked</span>}{contract.signed_document_url ? <a className="button button-secondary button-compact" href={contract.signed_document_url} rel="noreferrer" target="_blank">Open signed contract</a> : <span>Signed contract not linked</span>}{contract.w9_document_url ? <a className="button button-secondary button-compact" href={contract.w9_document_url} rel="noreferrer" target="_blank">Open W-9</a> : <span>W-9 not linked</span>}</div>
                </div>

                <form action={updateOperationsContract} className="operations-form-grid operations-record-body">
                  <input name="contract_id" type="hidden" value={contract.id} />
                  <ContractFields contract={contract} prefix={`contract-${contract.id}`} productions={productions} />
                  <div className="operations-form-actions field-span-2"><button className="button button-primary" type="submit">Save contract</button></div>
                </form>

                <section className="operations-contract-payments">
                  <div className="operations-section-heading">
                    <div>
                      <span className="eyebrow">Schedule A compensation</span>
                      <h3>Payment schedule</h3>
                      <p>Select a budget line once and this installment will update the production budget automatically as its amount, date, invoice, or payment status changes.</p>
                    </div>
                    <div>
                      <span className="badge">{linkedPaymentCount}/{payments.length} linked to budget</span>
                      {contract.production_id ? <a className="text-button" href={`/portal/admin/operations/budgets/${contract.production_id}`}>Open production budget</a> : null}
                    </div>
                  </div>
                  <div className="operations-payment-list">
                    {payments.map((payment) => (
                      <div className="operations-payment-row" key={payment.id}>
                        <form action={updateContractPayment} className="operations-payment-form">
                          <input name="payment_id" type="hidden" value={payment.id} />
                          <input name="production_id" type="hidden" value={contract.production_id ?? ""} />
                          <div className="field"><label>Order</label><input className="input" defaultValue={payment.installment_order} min="0" name="installment_order" type="number" /></div>
                          <div className="field"><label>Payment label</label><input className="input" defaultValue={payment.label} name="label" required /></div>
                          <div className="field"><label>Amount</label><input className="input" defaultValue={payment.amount} min="0" name="amount" step="0.01" type="number" /></div>
                          <div className="field"><label>Due date</label><input className="input" defaultValue={payment.due_date ?? ""} name="due_date" type="date" /></div>
                          <div className="field"><label>Status</label><select className="select" defaultValue={payment.status} name="status">{paymentStatuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></div>
                          <div className="field">
                            <label>Budget line</label>
                            <select className="select" defaultValue={payment.budget_line_id ?? ""} disabled={!contract.production_id || contractBudgetLines.length === 0} name="budget_line_id">
                              <option value="">Not linked</option>
                              {contractBudgetLines.map((budgetLine) => <option key={budgetLine.id} value={budgetLine.id}>{budgetLine.gl_code}{budgetLine.department ? ` · ${budgetLine.department}` : ""}</option>)}
                            </select>
                            <small>{!contract.production_id ? "Choose a production on the contract first." : contractBudgetLines.length === 0 ? "Add a budget line to this production first." : payment.budget_line_id ? "This installment is updating the production budget automatically." : "Choose where this contract expense belongs."}</small>
                          </div>
                          <div className="field"><label>Invoice received</label><input className="input" defaultValue={dateInput(payment.invoice_received_at)} name="invoice_received_on" type="date" /></div>
                          <div className="field"><label>Paid</label><input className="input" defaultValue={dateInput(payment.paid_at)} name="paid_on" type="date" /></div>
                          <div className="field field-span-2"><label>Deliverable</label><input className="input" defaultValue={payment.deliverable ?? ""} name="deliverable" /></div>
                          <div className="field field-span-2"><label>Notes</label><input className="input" defaultValue={payment.notes ?? ""} name="notes" /></div>
                          <div className="operations-form-actions field-span-2"><button className="button button-secondary button-compact" type="submit">Save payment</button></div>
                        </form>
                        <form action={deleteContractPayment} className="operations-inline-delete"><input name="payment_id" type="hidden" value={payment.id} /><input name="production_id" type="hidden" value={contract.production_id ?? ""} /><ConfirmedSubmitButton className="text-button danger-text" destructive description="This permanently removes this payment installment and its linked budget transaction." label="Delete payment" title={`Delete ${payment.label}?`} /></form>
                      </div>
                    ))}
                    {payments.length === 0 ? <p className="operations-muted">No payment installments added yet.</p> : null}
                  </div>
                  <details className="operations-add-payment">
                    <summary>Add payment installment</summary>
                    <form action={createContractPayment} className="operations-form-grid">
                      <input name="contract_id" type="hidden" value={contract.id} />
                      <input name="production_id" type="hidden" value={contract.production_id ?? ""} />
                      <div className="field"><label>Order</label><input className="input" defaultValue={payments.length + 1} min="0" name="installment_order" type="number" /></div>
                      <div className="field"><label>Payment label</label><input className="input" name="label" placeholder="First installment" required /></div>
                      <div className="field"><label>Amount</label><input className="input" min="0" name="amount" step="0.01" type="number" /></div>
                      <div className="field"><label>Due date</label><input className="input" name="due_date" type="date" /></div>
                      <div className="field"><label>Status</label><select className="select" defaultValue="scheduled" name="status">{paymentStatuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></div>
                      <div className="field">
                        <label>Budget line</label>
                        <select className="select" defaultValue="" disabled={!contract.production_id || contractBudgetLines.length === 0} name="budget_line_id">
                          <option value="">Not linked</option>
                          {contractBudgetLines.map((budgetLine) => <option key={budgetLine.id} value={budgetLine.id}>{budgetLine.gl_code}{budgetLine.department ? ` · ${budgetLine.department}` : ""}</option>)}
                        </select>
                        <small>{!contract.production_id ? "Choose a production on the contract first." : contractBudgetLines.length === 0 ? "Add a budget line to this production first." : "The linked budget entry will be created when this installment is added."}</small>
                      </div>
                      <div className="field"><label>Deliverable</label><input className="input" name="deliverable" /></div>
                      <div className="field field-span-2"><label>Notes</label><input className="input" name="notes" /></div>
                      <div className="operations-form-actions field-span-2"><button className="button button-primary button-compact" type="submit">Add installment</button></div>
                    </form>
                  </details>
                </section>

                <form action={deleteOperationsContract} className="operations-danger-zone">
                  <div><strong>Delete contract record</strong><p>This removes the contract and its payment schedule. It does not delete the contractor’s portal account or chat history.</p></div>
                  <input name="contract_id" type="hidden" value={contract.id} />
                  <ConfirmedSubmitButton className="button button-danger button-compact" destructive description="This permanently removes the contract record and every linked payment installment." label="Delete contract" title={`Delete ${contract.contractor_name}'s contract?`} />
                </form>
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}
