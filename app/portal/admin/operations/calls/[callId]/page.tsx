import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmedSubmitButton } from "@/components/confirmed-submit-button";
import { OperationsExportMenu } from "@/components/operations-export-menu";
import { createClient } from "@/lib/supabase/server";

import { addCallAssignment, deleteCallAssignment, deleteCall, updateCall, updateCallAssignment } from "../../actions";

type CallRow = { id: string; production_id: string; schedule_event_id: string | null; location_id: string | null; call_date: string; start_time: string | null; end_time: string | null; meal_1_start: string | null; meal_1_end: string | null; meal_2_start: string | null; meal_2_end: string | null; call_type: string; status: string; description: string; notes: string | null; original_budget: number | string; is_final: boolean };
type Assignment = { id: string; profile_id: string | null; department_id: string | null; crew_name: string | null; job_title: string | null; employment_type: string | null; assignment_status: string; time_1_start: string | null; time_1_end: string | null; time_2_start: string | null; time_2_end: string | null; time_3_start: string | null; time_3_end: string | null; hourly_rate: number | string | null; flat_rate: number | string | null; estimated_hours: number | string | null; actual_hours: number | string | null; estimated_pay: number | string | null; actual_pay: number | string | null; notes: string | null };
type Option = { id: string; name: string };
type ProfileOption = { id: string; full_name: string | null; email: string | null };
type ScheduleOption = { id: string; title: string; event_date: string };

const callTypes = ["load_in", "load_out", "shop_build", "rehearsal", "tech", "dress_rehearsal", "performance", "maintenance", "strike", "general"];
const callStatuses = ["draft", "scheduled", "final", "cancelled", "archived"];
const assignmentStatuses = ["scheduled", "confirmed", "declined", "complete", "cancelled"];
function label(value: string) { return value.replaceAll("_", " "); }
function inputTime(value: string | null) { return value?.slice(0, 5) ?? ""; }
function money(value: number | string | null) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0)); }

export default async function CallDetailPage({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const supabase = await createClient();
  const [callResult, assignmentResult, productionResult, locationResult, scheduleResult, departmentResult, profileResult] = await Promise.all([
    supabase.from("ghsmta_operations_calls").select("id,production_id,schedule_event_id,location_id,call_date,start_time,end_time,meal_1_start,meal_1_end,meal_2_start,meal_2_end,call_type,status,description,notes,original_budget,is_final").eq("id", callId).maybeSingle(),
    supabase.from("ghsmta_operations_call_assignments").select("id,profile_id,department_id,crew_name,job_title,employment_type,assignment_status,time_1_start,time_1_end,time_2_start,time_2_end,time_3_start,time_3_end,hourly_rate,flat_rate,estimated_hours,actual_hours,estimated_pay,actual_pay,notes").eq("call_id", callId).order("time_1_start", { nullsFirst: false }).order("crew_name"),
    supabase.from("ghsmta_operations_productions").select("id,name").order("name"),
    supabase.from("ghsmta_operations_locations").select("id,name").eq("active", true).order("name"),
    supabase.from("ghsmta_operations_schedule_events").select("id,title,event_date").order("event_date"),
    supabase.from("ghsmta_operations_departments").select("id,name").eq("active", true).order("sort_order").order("name"),
    supabase.from("profiles").select("id,full_name,email").eq("active", true).order("full_name"),
  ]);
  if (callResult.error) throw new Error(callResult.error.message);
  if (!callResult.data) notFound();
  const loadError = assignmentResult.error || productionResult.error || locationResult.error || scheduleResult.error || departmentResult.error || profileResult.error;
  if (loadError) throw new Error(loadError.message);

  const call = callResult.data as CallRow;
  const assignments = (assignmentResult.data ?? []) as Assignment[];
  const productions = (productionResult.data ?? []) as Option[];
  const locations = (locationResult.data ?? []) as Option[];
  const scheduleEvents = (scheduleResult.data ?? []) as ScheduleOption[];
  const departments = (departmentResult.data ?? []) as Option[];
  const profiles = (profileResult.data ?? []) as ProfileOption[];
  const profileMap = new Map(profiles.map((item) => [item.id, item.full_name || item.email || "Portal user"]));
  const departmentMap = new Map(departments.map((item) => [item.id, item.name]));
  const estimatedTotal = assignments.reduce((total, item) => total + Number(item.estimated_pay || 0), 0);
  const actualTotal = assignments.reduce((total, item) => total + Number(item.actual_pay || 0), 0);

  return (
    <div className="operations-stack">
      <section className="operations-section-heading"><div><Link className="operations-back-link" href="/portal/admin/operations/calls">← All calls</Link><span className="eyebrow">GHSMTA call sheet</span><h2>{call.description}</h2><p>Manage the call schedule, meal windows, crew assignments, payroll estimates, and actuals.</p></div><span className={`badge badge-${call.status}`}>{call.is_final ? "final" : label(call.status)}</span></section>

      <OperationsExportMenu
        description="GHSMTA individual call, sign-in, payroll, and crew reports."
        options={[
          { label: "Call Sheet PDF", module: "calls", format: "pdf", variant: "call-sheet", query: { callId: call.id } },
          { label: "Payroll Cost PDF", module: "calls", format: "pdf", variant: "payroll", query: { callId: call.id } },
          { label: "Sign-In Sheet PDF", module: "calls", format: "pdf", variant: "daily-sign-in", query: { callId: call.id } },
          { label: "Crew Schedule PDF", module: "calls", format: "pdf", variant: "person-schedule", query: { callId: call.id } },
          { label: "Department Schedule CSV", module: "calls", format: "csv", variant: "department-schedule", query: { callId: call.id } },
        ]}
      />

      <section className="operations-summary-grid operations-summary-grid-three"><article><span>Assigned crew</span><strong>{assignments.length}</strong><small>People and open positions</small></article><article><span>Estimated payroll</span><strong>{money(estimatedTotal)}</strong><small>From rates and estimates</small></article><article><span>Actual payroll</span><strong>{money(actualTotal)}</strong><small>Entered actual pay</small></article></section>

      <details className="panel operations-create-panel">
        <summary><span><strong>Edit call details</strong><small>Update times, meals, location, budget, and final status.</small></span><span aria-hidden="true">＋</span></summary>
        <form action={updateCall} className="operations-form-grid panel-body">
          <input name="call_id" type="hidden" value={call.id} />
          <div className="field"><label>Production</label><select className="select" defaultValue={call.production_id} name="production_id" required>{productions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="field"><label>Call title / description</label><input className="input" defaultValue={call.description} name="description" required /></div>
          <div className="field"><label>Call type</label><select className="select" defaultValue={call.call_type} name="call_type">{callTypes.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
          <div className="field"><label>Status</label><select className="select" defaultValue={call.status} name="status">{callStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
          <div className="field"><label>Date</label><input className="input" defaultValue={call.call_date} name="call_date" required type="date" /></div>
          <div className="field"><label>Location</label><select className="select" defaultValue={call.location_id ?? ""} name="location_id"><option value="">Not set</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="field"><label>Start</label><input className="input" defaultValue={inputTime(call.start_time)} name="start_time" type="time" /></div>
          <div className="field"><label>End</label><input className="input" defaultValue={inputTime(call.end_time)} name="end_time" type="time" /></div>
          <div className="field field-span-2"><label>Linked schedule event</label><select className="select" defaultValue={call.schedule_event_id ?? ""} name="schedule_event_id"><option value="">Not linked</option>{scheduleEvents.map((item) => <option key={item.id} value={item.id}>{item.event_date} · {item.title}</option>)}</select></div>
          <div className="field"><label>Meal 1 start</label><input className="input" defaultValue={inputTime(call.meal_1_start)} name="meal_1_start" type="time" /></div><div className="field"><label>Meal 1 end</label><input className="input" defaultValue={inputTime(call.meal_1_end)} name="meal_1_end" type="time" /></div>
          <div className="field"><label>Meal 2 start</label><input className="input" defaultValue={inputTime(call.meal_2_start)} name="meal_2_start" type="time" /></div><div className="field"><label>Meal 2 end</label><input className="input" defaultValue={inputTime(call.meal_2_end)} name="meal_2_end" type="time" /></div>
          <div className="field"><label>Original labor budget</label><input className="input" defaultValue={String(call.original_budget ?? 0)} min="0" name="original_budget" step="0.01" type="number" /></div>
          <div className="field field-span-2"><label>Notes</label><textarea className="textarea" defaultValue={call.notes ?? ""} name="notes" rows={3} /></div>
          <div className="operations-check-row field-span-2"><label><input defaultChecked={call.is_final} name="is_final" type="checkbox" /> Final call sheet</label></div>
          <div className="operations-form-actions field-span-2"><button className="button button-primary" type="submit">Save call</button></div>
        </form>
      </details>

      <details className="panel operations-create-panel" open={assignments.length === 0}>
        <summary><span><strong>Add crew assignment</strong><small>Assign a portal user or add an external crew name and payroll estimate.</small></span><span aria-hidden="true">＋</span></summary>
        <form action={addCallAssignment} className="operations-form-grid panel-body">
          <input name="call_id" type="hidden" value={call.id} />
          <div className="field"><label htmlFor="assignment-profile">Portal user</label><select className="select" id="assignment-profile" name="profile_id"><option value="">Not a portal user</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.full_name || item.email}</option>)}</select></div>
          <div className="field"><label htmlFor="assignment-name">External crew name / open position</label><input className="input" id="assignment-name" name="crew_name" placeholder="Use when no portal user is selected" /></div>
          <div className="field"><label htmlFor="assignment-department">Department</label><select className="select" id="assignment-department" name="department_id"><option value="">Unassigned</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="field"><label htmlFor="assignment-job">Job title</label><input className="input" id="assignment-job" name="job_title" /></div>
          <div className="field"><label htmlFor="assignment-employment">Employment type</label><input className="input" id="assignment-employment" name="employment_type" placeholder="Employee, contractor, volunteer" /></div>
          <div className="field"><label htmlFor="assignment-status">Status</label><select className="select" defaultValue="scheduled" id="assignment-status" name="assignment_status">{assignmentStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
          <div className="field"><label>Session 1 start</label><input className="input" name="time_1_start" type="time" /></div><div className="field"><label>Session 1 end</label><input className="input" name="time_1_end" type="time" /></div>
          <div className="field"><label>Session 2 start</label><input className="input" name="time_2_start" type="time" /></div><div className="field"><label>Session 2 end</label><input className="input" name="time_2_end" type="time" /></div>
          <div className="field"><label>Session 3 start</label><input className="input" name="time_3_start" type="time" /></div><div className="field"><label>Session 3 end</label><input className="input" name="time_3_end" type="time" /></div>
          <div className="field"><label>Hourly rate</label><input className="input" min="0" name="hourly_rate" step="0.01" type="number" /></div><div className="field"><label>Flat rate</label><input className="input" min="0" name="flat_rate" step="0.01" type="number" /></div>
          <div className="field"><label>Estimated hours</label><input className="input" min="0" name="estimated_hours" step="0.25" type="number" /></div>
          <div className="field field-span-2"><label>Notes</label><textarea className="textarea" name="notes" rows={2} /></div>
          <div className="operations-form-actions field-span-2"><button className="button button-primary" type="submit">Add assignment</button></div>
        </form>
      </details>

      <section className="panel operations-table-panel"><div className="panel-header"><div><span className="eyebrow">Call roster</span><h2>Crew assignments</h2></div><span className="badge">{assignments.length} assigned</span></div><div className="operations-table-scroll"><table className="data-table operations-table"><thead><tr><th>Person / position</th><th>Department</th><th>Sessions</th><th>Estimate</th><th>Actual</th><th>Status & actions</th></tr></thead><tbody>
        {assignments.length === 0 ? <tr><td colSpan={6}><div className="operations-empty"><strong>No crew assigned</strong><p>Add the first crew member or open position above.</p></div></td></tr> : assignments.map((assignment) => (
          <tr key={assignment.id}>
            <td><strong>{assignment.profile_id ? profileMap.get(assignment.profile_id) : assignment.crew_name || "Open position"}</strong><small>{assignment.job_title || assignment.employment_type || "Role not set"}</small></td>
            <td>{assignment.department_id ? departmentMap.get(assignment.department_id) : "—"}</td>
            <td><small>{[[assignment.time_1_start, assignment.time_1_end], [assignment.time_2_start, assignment.time_2_end], [assignment.time_3_start, assignment.time_3_end]].filter(([start]) => start).map(([start, end]) => `${inputTime(start)}–${inputTime(end) || "?"}`).join(" · ") || "Not set"}</small></td>
            <td>{money(assignment.estimated_pay)}</td><td>{money(assignment.actual_pay)}</td>
            <td><form action={updateCallAssignment} className="operations-assignment-update"><input name="assignment_id" type="hidden" value={assignment.id} /><input name="call_id" type="hidden" value={call.id} /><select className="select" defaultValue={assignment.assignment_status} name="assignment_status">{assignmentStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select><input className="input" defaultValue={assignment.actual_hours ?? ""} min="0" name="actual_hours" placeholder="Hours" step="0.25" type="number" /><input className="input" defaultValue={assignment.actual_pay ?? ""} min="0" name="actual_pay" placeholder="Actual pay" step="0.01" type="number" /><input name="notes" type="hidden" value={assignment.notes ?? ""} /><button className="button button-primary button-compact" type="submit">Save</button></form><form action={deleteCallAssignment} className="operations-inline-delete"><input name="assignment_id" type="hidden" value={assignment.id} /><input name="call_id" type="hidden" value={call.id} /><ConfirmedSubmitButton className="button button-danger button-compact" destructive description="This removes the crew assignment from the call." label="Remove" title="Remove assignment?" /></form></td>
          </tr>
        ))}
      </tbody></table></div></section>

      <form action={deleteCall} className="operations-danger-zone panel"><input name="call_id" type="hidden" value={call.id} /><div><strong>Delete call</strong><p>Deletes this call and all connected crew assignments.</p></div><ConfirmedSubmitButton className="button button-danger" destructive description="This permanently removes the call and all crew assignments." label="Delete call" title={`Delete ${call.description}?`} /></form>
    </div>
  );
}
