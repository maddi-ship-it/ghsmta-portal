import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmedSubmitButton } from "@/components/confirmed-submit-button";
import { OperationsExportMenu } from "@/components/operations-export-menu";
import { createClient } from "@/lib/supabase/server";

import { createBudgetLine, createBudgetTransaction, deleteBudgetLine, deleteBudgetTransaction, updateBudgetLine, updateBudgetTransaction } from "../../actions";

type Production = { id: string; name: string; code: string | null; status: string };
type BudgetLine = { id: string; gl_code: string; department: string | null; original_budget: number | string; approved_changes: number | string; current_budget: number | string; notes: string | null };
type Transaction = { id: string; budget_line_id: string | null; gl_code: string; department: string | null; amount: number | string; status: string; description: string; vendor_name: string | null; invoice_received: boolean; receipt_uploaded: boolean; document_link: string | null; transaction_date: string };
type Department = { id: string; name: string };

const transactionStatuses = ["requested", "approved", "committed", "invoiced", "estimated", "paid", "cancelled"];
function label(value: string) { return value.replaceAll("_", " "); }
function money(value: number | string | null) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0)); }

export default async function ProductionBudgetPage({ params }: { params: Promise<{ productionId: string }> }) {
  const { productionId } = await params;
  const supabase = await createClient();
  const [productionResult, lineResult, transactionResult, departmentResult] = await Promise.all([
    supabase.from("ghsmta_operations_productions").select("id,name,code,status").eq("id", productionId).maybeSingle(),
    supabase.from("ghsmta_operations_budget_lines").select("id,gl_code,department,original_budget,approved_changes,current_budget,notes").eq("production_id", productionId).order("gl_code"),
    supabase.from("ghsmta_operations_budget_transactions").select("id,budget_line_id,gl_code,department,amount,status,description,vendor_name,invoice_received,receipt_uploaded,document_link,transaction_date").eq("production_id", productionId).order("transaction_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("ghsmta_operations_departments").select("id,name").eq("active", true).order("sort_order").order("name"),
  ]);
  if (productionResult.error) throw new Error(productionResult.error.message);
  if (!productionResult.data) notFound();
  const loadError = lineResult.error || transactionResult.error || departmentResult.error;
  if (loadError) throw new Error(loadError.message);

  const production = productionResult.data as Production;
  const lines = (lineResult.data ?? []) as BudgetLine[];
  const transactions = (transactionResult.data ?? []) as Transaction[];
  const departments = (departmentResult.data ?? []) as Department[];
  const current = lines.reduce((sum, line) => sum + Number(line.current_budget || 0), 0);
  const paid = transactions.filter((item) => item.status === "paid").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const estimated = transactions.filter((item) => !["paid", "cancelled"].includes(item.status)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const forecast = paid + estimated;
  const remaining = current - forecast;
  const lineMap = new Map(lines.map((line) => [line.id, line]));

  return (
    <div className="operations-stack">
      <section className="operations-section-heading"><div><Link className="operations-back-link" href="/portal/admin/operations/budgets">← All budgets</Link><span className="eyebrow">GHSMTA production budget</span><h2>{production.name}</h2><p>{production.code ? `${production.code} · ` : ""}Budget lines, commitments, actuals, and forecast details.</p></div><span className={`badge badge-${production.status}`}>{label(production.status)}</span></section>

      <OperationsExportMenu
        description="GHSMTA production budget and detailed transaction reports."
        options={[
          { label: "Budget PDF", module: "budgets", format: "pdf", variant: "budget", query: { production: production.id } },
          { label: "Detail PDF", module: "budgets", format: "pdf", variant: "detail", query: { production: production.id } },
          { label: "Detail CSV", module: "budgets", format: "csv", variant: "detail", query: { production: production.id } },
        ]}
      />

      <section className="operations-summary-grid operations-budget-summary"><article><span>Current budget</span><strong>{money(current)}</strong><small>Original + approved changes</small></article><article><span>Estimated</span><strong>{money(estimated)}</strong><small>Open expenses</small></article><article><span>Paid</span><strong>{money(paid)}</strong><small>Actuals</small></article><article><span>Forecast</span><strong>{money(forecast)}</strong><small>Estimated + paid</small></article><article><span>Remaining</span><strong className={remaining < 0 ? "operations-negative" : ""}>{money(remaining)}</strong><small>Current budget − forecast</small></article></section>

      <details className="panel operations-create-panel" open={lines.length === 0}>
        <summary><span><strong>Add budget line</strong><small>Create a GL line with its original budget and approved changes.</small></span><span aria-hidden="true">＋</span></summary>
        <form action={createBudgetLine} className="operations-form-grid panel-body"><input name="production_id" type="hidden" value={production.id} /><div className="field"><label htmlFor="budget-gl">GL code</label><input className="input" id="budget-gl" name="gl_code" required /></div><div className="field"><label htmlFor="budget-department">Department</label><select className="select" id="budget-department" name="department"><option value="">Not set</option>{departments.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></div><div className="field"><label htmlFor="original-budget">Original budget</label><input className="input" defaultValue="0" id="original-budget" name="original_budget" step="0.01" type="number" /></div><div className="field"><label htmlFor="approved-changes">Approved changes</label><input className="input" defaultValue="0" id="approved-changes" name="approved_changes" step="0.01" type="number" /></div><div className="field field-span-2"><label htmlFor="budget-line-notes">Notes</label><textarea className="textarea" id="budget-line-notes" name="notes" rows={2} /></div><div className="operations-form-actions field-span-2"><button className="button button-primary" type="submit">Add budget line</button></div></form>
      </details>

      <section className="panel operations-table-panel"><div className="panel-header"><div><span className="eyebrow">Budget plan</span><h2>GL budget lines</h2></div><span className="badge">{lines.length} lines</span></div><div className="operations-card-list panel-body">
        {lines.length === 0 ? <div className="operations-empty"><strong>No budget lines</strong><p>Add the first GL budget line above.</p></div> : lines.map((line) => {
          const lineTransactions = transactions.filter((item) => item.budget_line_id === line.id || (!item.budget_line_id && item.gl_code === line.gl_code));
          const lineForecast = lineTransactions.filter((item) => item.status !== "cancelled").reduce((sum, item) => sum + Number(item.amount || 0), 0);
          return <details className="operations-record" key={line.id}><summary><div><span className="badge">{line.gl_code}</span><strong>{line.department || "Unassigned department"}</strong><small>Budget {money(line.current_budget)} · Forecast {money(lineForecast)} · Remaining {money(Number(line.current_budget || 0) - lineForecast)}</small></div><span className="operations-record-action">Edit</span></summary><form action={updateBudgetLine} className="operations-form-grid operations-record-body"><input name="production_id" type="hidden" value={production.id} /><input name="line_id" type="hidden" value={line.id} /><div className="field"><label>GL code</label><input className="input" defaultValue={line.gl_code} name="gl_code" required /></div><div className="field"><label>Department</label><select className="select" defaultValue={line.department ?? ""} name="department"><option value="">Not set</option>{departments.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></div><div className="field"><label>Original budget</label><input className="input" defaultValue={String(line.original_budget)} name="original_budget" step="0.01" type="number" /></div><div className="field"><label>Approved changes</label><input className="input" defaultValue={String(line.approved_changes)} name="approved_changes" step="0.01" type="number" /></div><div className="field field-span-2"><label>Notes</label><textarea className="textarea" defaultValue={line.notes ?? ""} name="notes" rows={2} /></div><div className="operations-form-actions field-span-2"><button className="button button-primary button-compact" type="submit">Save budget line</button></div></form><form action={deleteBudgetLine} className="operations-danger-zone"><input name="production_id" type="hidden" value={production.id} /><input name="line_id" type="hidden" value={line.id} /><ConfirmedSubmitButton className="button button-danger button-compact" destructive description="This removes the budget line. Existing expenses remain but become unlinked from it." label="Delete line" title={`Delete ${line.gl_code}?`} /></form></details>;
        })}
      </div></section>

      <details className="panel operations-create-panel">
        <summary><span><strong>Add expense / transaction</strong><small>Record a request, commitment, invoice, estimate, or paid actual.</small></span><span aria-hidden="true">＋</span></summary>
        <form action={createBudgetTransaction} className="operations-form-grid panel-body"><input name="production_id" type="hidden" value={production.id} /><div className="field field-span-2"><label htmlFor="expense-description">Description</label><input className="input" id="expense-description" name="description" required /></div><div className="field"><label htmlFor="expense-line">Budget line</label><select className="select" id="expense-line" name="budget_line_id"><option value="">Not linked</option>{lines.map((line) => <option key={line.id} value={line.id}>{line.gl_code} · {line.department || "Unassigned"}</option>)}</select></div><div className="field"><label htmlFor="expense-gl">GL code</label><input className="input" id="expense-gl" name="gl_code" required /></div><div className="field"><label htmlFor="expense-department">Department</label><select className="select" id="expense-department" name="department"><option value="">Not set</option>{departments.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></div><div className="field"><label htmlFor="expense-amount">Amount</label><input className="input" id="expense-amount" name="amount" required step="0.01" type="number" /></div><div className="field"><label htmlFor="expense-status">Status</label><select className="select" defaultValue="requested" id="expense-status" name="status">{transactionStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div><div className="field"><label htmlFor="expense-vendor">Vendor</label><input className="input" id="expense-vendor" name="vendor_name" /></div><div className="field"><label htmlFor="expense-date">Transaction date</label><input className="input" defaultValue={new Date().toISOString().slice(0, 10)} id="expense-date" name="transaction_date" required type="date" /></div><div className="field field-span-2"><label htmlFor="expense-link">Invoice / receipt link</label><input className="input" id="expense-link" name="document_link" type="url" /></div><div className="operations-check-row field-span-2"><label><input name="invoice_received" type="checkbox" /> Invoice received</label><label><input name="receipt_uploaded" type="checkbox" /> Receipt uploaded</label></div><div className="operations-form-actions field-span-2"><button className="button button-primary" type="submit">Add transaction</button></div></form>
      </details>

      <section className="panel operations-table-panel"><div className="panel-header"><div><span className="eyebrow">Expense ledger</span><h2>Transactions</h2></div><span className="badge">{transactions.length} entries</span></div><div className="operations-table-scroll"><table className="data-table operations-table"><thead><tr><th>Date</th><th>Description</th><th>GL / department</th><th>Vendor</th><th>Amount</th><th>Status & documents</th><th>Actions</th></tr></thead><tbody>
        {transactions.length === 0 ? <tr><td colSpan={7}><div className="operations-empty"><strong>No transactions</strong><p>Add a request, commitment, invoice, estimate, or paid actual above.</p></div></td></tr> : transactions.map((transaction) => (
          <tr key={transaction.id}><td>{transaction.transaction_date}</td><td><strong>{transaction.description}</strong><small>{transaction.budget_line_id ? `Linked to ${lineMap.get(transaction.budget_line_id)?.gl_code || "budget line"}` : "Not linked to a budget line"}</small></td><td><strong>{transaction.gl_code}</strong><small>{transaction.department || "—"}</small></td><td>{transaction.vendor_name || "—"}</td><td><strong>{money(transaction.amount)}</strong></td><td><form action={updateBudgetTransaction} className="operations-transaction-update"><input name="production_id" type="hidden" value={production.id} /><input name="transaction_id" type="hidden" value={transaction.id} /><select className="select" defaultValue={transaction.status} name="status">{transactionStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select><label><input defaultChecked={transaction.invoice_received} name="invoice_received" type="checkbox" /> Invoice</label><label><input defaultChecked={transaction.receipt_uploaded} name="receipt_uploaded" type="checkbox" /> Receipt</label><input className="input" defaultValue={transaction.document_link ?? ""} name="document_link" placeholder="Document link" type="url" /><button className="button button-primary button-compact" type="submit">Save</button></form></td><td><form action={deleteBudgetTransaction}><input name="production_id" type="hidden" value={production.id} /><input name="transaction_id" type="hidden" value={transaction.id} /><ConfirmedSubmitButton className="button button-danger button-compact" destructive description="This permanently removes the budget transaction." label="Delete" title={`Delete ${transaction.description}?`} /></form></td></tr>
        ))}
      </tbody></table></div></section>
    </div>
  );
}
