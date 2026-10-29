import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

type Production = { id: string; name: string; code: string | null; status: string };
type BudgetLine = { production_id: string; current_budget: number | string };
type Transaction = { production_id: string; amount: number | string; status: string };

type Summary = { current: number; estimated: number; paid: number; forecast: number; remaining: number };

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function statusLabel(value: string) { return value.replaceAll("_", " "); }

export default async function OperationsBudgetsPage() {
  const supabase = await createClient();
  const [productionResult, lineResult, transactionResult] = await Promise.all([
    supabase.from("ghsmta_operations_productions").select("id,name,code,status").not("status", "in", "(cancelled,archived)").order("name"),
    supabase.from("ghsmta_operations_budget_lines").select("production_id,current_budget"),
    supabase.from("ghsmta_operations_budget_transactions").select("production_id,amount,status"),
  ]);
  const loadError = productionResult.error || lineResult.error || transactionResult.error;
  if (loadError) throw new Error(loadError.message);

  const productions = (productionResult.data ?? []) as Production[];
  const lines = (lineResult.data ?? []) as BudgetLine[];
  const transactions = (transactionResult.data ?? []) as Transaction[];
  const summaries = new Map<string, Summary>();
  productions.forEach((production) => summaries.set(production.id, { current: 0, estimated: 0, paid: 0, forecast: 0, remaining: 0 }));
  lines.forEach((line) => { const summary = summaries.get(line.production_id); if (summary) summary.current += Number(line.current_budget || 0); });
  transactions.forEach((transaction) => { const summary = summaries.get(transaction.production_id); if (!summary || transaction.status === "cancelled") return; const amount = Number(transaction.amount || 0); if (transaction.status === "paid") summary.paid += amount; else summary.estimated += amount; });
  summaries.forEach((summary) => { summary.forecast = summary.paid + summary.estimated; summary.remaining = summary.current - summary.forecast; });
  const totals = Array.from(summaries.values()).reduce((result, summary) => ({ current: result.current + summary.current, estimated: result.estimated + summary.estimated, paid: result.paid + summary.paid, forecast: result.forecast + summary.forecast, remaining: result.remaining + summary.remaining }), { current: 0, estimated: 0, paid: 0, forecast: 0, remaining: 0 });

  return (
    <div className="operations-stack">
      <section className="operations-section-heading"><div><span className="eyebrow">GHSMTA production finance</span><h2>Budgets</h2><p>Track original budgets, approved changes, commitments, paid actuals, forecasts, remaining funds, and variance.</p></div><span className="badge">{productions.length} active budgets</span></section>

      <section className="operations-summary-grid operations-budget-summary" aria-label="Budget totals">
        <article><span>Current budget</span><strong>{money(totals.current)}</strong><small>Original + approved changes</small></article>
        <article><span>Estimated</span><strong>{money(totals.estimated)}</strong><small>Open commitments and requests</small></article>
        <article><span>Paid</span><strong>{money(totals.paid)}</strong><small>Recorded actuals</small></article>
        <article><span>Forecast</span><strong>{money(totals.forecast)}</strong><small>Estimated + paid</small></article>
        <article><span>Remaining</span><strong className={totals.remaining < 0 ? "operations-negative" : ""}>{money(totals.remaining)}</strong><small>Current budget − forecast</small></article>
      </section>

      <section className="panel operations-table-panel"><div className="panel-header"><div><span className="eyebrow">Active financial workspaces</span><h2>Production budgets</h2></div></div><div className="operations-table-scroll"><table className="data-table operations-table operations-budget-table"><thead><tr><th>Production</th><th>Status</th><th>Current budget</th><th>Estimated</th><th>Paid</th><th>Forecast</th><th>Remaining</th><th>Action</th></tr></thead><tbody>
        {productions.length === 0 ? <tr><td colSpan={8}><div className="operations-empty"><strong>No active productions</strong><p>Create a GHSMTA production before building its budget.</p><Link className="button button-primary" href="/portal/admin/operations">Create production</Link></div></td></tr> : productions.map((production) => { const summary = summaries.get(production.id)!; return (
          <tr key={production.id}><td><strong>{production.name}</strong><small>{production.code || "No internal code"}</small></td><td><span className={`badge badge-${production.status}`}>{statusLabel(production.status)}</span></td><td>{money(summary.current)}</td><td>{money(summary.estimated)}</td><td>{money(summary.paid)}</td><td>{money(summary.forecast)}</td><td className={summary.remaining < 0 ? "operations-negative" : ""}><strong>{money(summary.remaining)}</strong></td><td><Link className="button button-secondary button-compact" href={`/portal/admin/operations/budgets/${production.id}`}>Open budget</Link></td></tr>
        ); })}
      </tbody></table></div></section>
    </div>
  );
}
