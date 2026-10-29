import Link from "next/link";

import { ConfirmedSubmitButton } from "@/components/confirmed-submit-button";
import { OperationsExportMenu } from "@/components/operations-export-menu";
import { createClient } from "@/lib/supabase/server";

import { createCall, deleteCall, duplicateCall } from "../actions";

type SearchParams = { production?: string; status?: string };
type Option = { id: string; name: string };
type ScheduleOption = { id: string; title: string; event_date: string };
type CallRow = {
  id: string;
  production_id: string;
  location_id: string | null;
  call_date: string;
  start_time: string | null;
  end_time: string | null;
  call_type: string;
  status: string;
  description: string;
  original_budget: number | string;
  is_final: boolean;
};
type AssignmentCount = { call_id: string };

const callTypes = ["load_in", "load_out", "shop_build", "rehearsal", "tech", "dress_rehearsal", "performance", "maintenance", "strike", "general"];
const callStatuses = ["draft", "scheduled", "final", "cancelled", "archived"];

function label(value: string) { return value.replaceAll("_", " "); }
function dateInput() { return new Date().toISOString().slice(0, 10); }
function formatMoney(value: number | string) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00Z`)); }
function formatTime(value: string | null) { if (!value) return ""; const [h, m = "00"] = value.split(":"); const hour = Number(h); return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`; }

export default async function OperationsCallsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = await searchParams;
  const supabase = await createClient();
  let callQuery = supabase
    .from("ghsmta_operations_calls")
    .select("id,production_id,location_id,call_date,start_time,end_time,call_type,status,description,original_budget,is_final")
    .order("call_date")
    .order("start_time", { nullsFirst: false });
  if (filters.production) callQuery = callQuery.eq("production_id", filters.production);
  if (filters.status) callQuery = callQuery.eq("status", filters.status);

  const [callResult, productionResult, locationResult, scheduleResult, assignmentResult] = await Promise.all([
    callQuery,
    supabase.from("ghsmta_operations_productions").select("id,name").not("status", "in", "(cancelled,archived)").order("name"),
    supabase.from("ghsmta_operations_locations").select("id,name").eq("active", true).order("name"),
    supabase.from("ghsmta_operations_schedule_events").select("id,title,event_date").not("status", "eq", "cancelled").order("event_date"),
    supabase.from("ghsmta_operations_call_assignments").select("call_id"),
  ]);
  const loadError = callResult.error || productionResult.error || locationResult.error || scheduleResult.error || assignmentResult.error;
  if (loadError) throw new Error(loadError.message);

  const calls = (callResult.data ?? []) as CallRow[];
  const productions = (productionResult.data ?? []) as Option[];
  const locations = (locationResult.data ?? []) as Option[];
  const scheduleEvents = (scheduleResult.data ?? []) as ScheduleOption[];
  const productionMap = new Map(productions.map((item) => [item.id, item.name]));
  const locationMap = new Map(locations.map((item) => [item.id, item.name]));
  const assignmentCounts = new Map<string, number>();
  ((assignmentResult.data ?? []) as AssignmentCount[]).forEach((item) => assignmentCounts.set(item.call_id, (assignmentCounts.get(item.call_id) ?? 0) + 1));

  return (
    <div className="operations-stack">
      <section className="operations-section-heading"><div><span className="eyebrow">GHSMTA production labor</span><h2>Calls</h2><p>Build labor calls, assign crew, track working sessions and payroll estimates, and finalize call sheets.</p></div><span className="badge">{calls.length} calls shown</span></section>

      <OperationsExportMenu
        description="GHSMTA call sheets, sign-in sheets, payroll, and crew schedules."
        options={[
          { label: "Call Sheet PDF", module: "calls", format: "pdf", variant: "call-sheet", query: { production: filters.production } },
          { label: "Payroll Cost PDF", module: "calls", format: "pdf", variant: "payroll", query: { production: filters.production } },
          { label: "Daily Sign-In Sheet PDF", module: "calls", format: "pdf", variant: "daily-sign-in", query: { production: filters.production } },
          { label: "Daily Payroll PDF", module: "calls", format: "pdf", variant: "daily-payroll", query: { production: filters.production } },
          { label: "Weekly Payroll Projection PDF", module: "calls", format: "pdf", variant: "weekly-payroll", query: { production: filters.production } },
          { label: "Crew Schedule PDF", module: "calls", format: "pdf", variant: "person-schedule", query: { production: filters.production } },
          { label: "Department Schedule CSV", module: "calls", format: "csv", variant: "department-schedule", query: { production: filters.production } },
        ]}
      />

      <details className="panel operations-create-panel" open={calls.length === 0 && productions.length > 0}>
        <summary><span><strong>Create a labor call</strong><small>Start a GHSMTA call and connect it to an optional master schedule event.</small></span><span aria-hidden="true">＋</span></summary>
        {productions.length === 0 ? <div className="panel-body operations-empty"><strong>Create a production first</strong><p>Calls must be connected to a GHSMTA production.</p><Link className="button button-primary" href="/portal/admin/operations">Set up productions</Link></div> : (
          <form action={createCall} className="operations-form-grid panel-body">
            <div className="field"><label htmlFor="call-production">Production</label><select className="select" id="call-production" name="production_id" required><option value="">Choose production</option>{productions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="field"><label htmlFor="call-description">Call title / description</label><input className="input" id="call-description" name="description" required /></div>
            <div className="field"><label htmlFor="call-type">Call type</label><select className="select" defaultValue="general" id="call-type" name="call_type">{callTypes.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
            <div className="field"><label htmlFor="call-status">Status</label><select className="select" defaultValue="draft" id="call-status" name="status">{callStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
            <div className="field"><label htmlFor="call-date">Date</label><input className="input" defaultValue={dateInput()} id="call-date" name="call_date" required type="date" /></div>
            <div className="field"><label htmlFor="call-location">Location</label><select className="select" id="call-location" name="location_id"><option value="">Not set</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="field"><label htmlFor="call-start">Start</label><input className="input" id="call-start" name="start_time" type="time" /></div>
            <div className="field"><label htmlFor="call-end">End</label><input className="input" id="call-end" name="end_time" type="time" /></div>
            <div className="field field-span-2"><label htmlFor="call-event">Linked schedule event</label><select className="select" id="call-event" name="schedule_event_id"><option value="">Not linked</option>{scheduleEvents.map((item) => <option key={item.id} value={item.id}>{item.event_date} · {item.title}</option>)}</select></div>
            <div className="field"><label htmlFor="meal-one-start">Meal 1 start</label><input className="input" id="meal-one-start" name="meal_1_start" type="time" /></div>
            <div className="field"><label htmlFor="meal-one-end">Meal 1 end</label><input className="input" id="meal-one-end" name="meal_1_end" type="time" /></div>
            <div className="field"><label htmlFor="meal-two-start">Meal 2 start</label><input className="input" id="meal-two-start" name="meal_2_start" type="time" /></div>
            <div className="field"><label htmlFor="meal-two-end">Meal 2 end</label><input className="input" id="meal-two-end" name="meal_2_end" type="time" /></div>
            <div className="field"><label htmlFor="call-budget">Original labor budget</label><input className="input" defaultValue="0" id="call-budget" min="0" name="original_budget" step="0.01" type="number" /></div>
            <div className="field field-span-2"><label htmlFor="call-notes">Notes</label><textarea className="textarea" id="call-notes" name="notes" rows={3} /></div>
            <div className="operations-form-actions field-span-2"><button className="button button-primary" type="submit">Create call</button></div>
          </form>
        )}
      </details>

      <form className="panel operations-filter-bar operations-filter-bar-compact" method="get">
        <div className="field"><label htmlFor="calls-production-filter">Production</label><select className="select" defaultValue={filters.production ?? ""} id="calls-production-filter" name="production"><option value="">All productions</option>{productions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="field"><label htmlFor="calls-status-filter">Status</label><select className="select" defaultValue={filters.status ?? ""} id="calls-status-filter" name="status"><option value="">All statuses</option>{callStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
        <div className="operations-filter-actions"><button className="button button-dark button-compact" type="submit">Apply</button><Link className="button button-secondary button-compact" href="/portal/admin/operations/calls">Clear</Link></div>
      </form>

      <section className="panel operations-table-panel">
        <div className="operations-table-scroll"><table className="data-table operations-table operations-calls-table"><thead><tr><th>Date</th><th>Call</th><th>Production</th><th>Location</th><th>Crew</th><th>Labor budget</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {calls.length === 0 ? <tr><td colSpan={8}><div className="operations-empty"><strong>No calls found</strong><p>Create a call or adjust the filters.</p></div></td></tr> : calls.map((call) => (
            <tr key={call.id}>
              <td><strong>{formatDate(call.call_date)}</strong><small>{[formatTime(call.start_time), formatTime(call.end_time)].filter(Boolean).join("–") || "Time not set"}</small></td>
              <td><Link href={`/portal/admin/operations/calls/${call.id}`}>{call.description}</Link><small>{label(call.call_type)}</small></td>
              <td>{productionMap.get(call.production_id) ?? "Unknown production"}</td>
              <td>{call.location_id ? locationMap.get(call.location_id) : "—"}</td>
              <td>{assignmentCounts.get(call.id) ?? 0}</td>
              <td>{formatMoney(call.original_budget)}</td>
              <td><span className={`badge badge-${call.status}`}>{call.is_final ? "final" : label(call.status)}</span></td>
              <td><div className="operations-table-actions"><Link className="button button-secondary button-compact" href={`/portal/admin/operations/calls/${call.id}`}>Open</Link><form action={duplicateCall}><input name="call_id" type="hidden" value={call.id} /><button className="button button-secondary button-compact" type="submit">Duplicate</button></form><form action={deleteCall}><input name="call_id" type="hidden" value={call.id} /><ConfirmedSubmitButton className="button button-danger button-compact" destructive description="This removes the call and all crew assignments." label="Delete" title={`Delete ${call.description}?`} /></form></div></td>
            </tr>
          ))}
        </tbody></table></div>
      </section>
    </div>
  );
}
