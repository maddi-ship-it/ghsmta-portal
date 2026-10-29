import Link from "next/link";

import { ConfirmedSubmitButton } from "@/components/confirmed-submit-button";
import { createClient } from "@/lib/supabase/server";

import {
  createScheduleEvent,
  deleteScheduleEvent,
  duplicateScheduleEvent,
  updateScheduleEvent,
} from "../actions";

type SearchParams = { production?: string; type?: string; status?: string; from?: string; to?: string };
type Option = { id: string; name: string };
type EventRow = {
  id: string;
  production_id: string | null;
  department_id: string | null;
  location_id: string | null;
  title: string;
  event_type: string;
  status: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  visibility: string;
  is_deadline: boolean;
  is_announcement: boolean;
  description: string | null;
  notes: string | null;
};

const eventTypes = ["general", "meeting", "deadline", "rehearsal", "load_in", "load_out", "tech", "dress_rehearsal", "performance", "maintenance", "strike", "announcement"];
const eventStatuses = ["draft", "scheduled", "confirmed", "complete", "cancelled"];

function label(value: string) {
  return value.replaceAll("_", " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

function formatTime(value: string | null) {
  if (!value) return "";
  const [hourText, minute = "00"] = value.split(":");
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function dateInput(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export default async function OperationsSchedulePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("ghsmta_operations_schedule_events")
    .select("id,production_id,department_id,location_id,title,event_type,status,event_date,start_time,end_time,all_day,visibility,is_deadline,is_announcement,description,notes")
    .order("event_date")
    .order("start_time", { nullsFirst: false });
  if (filters.production) query = query.eq("production_id", filters.production);
  if (filters.type) query = query.eq("event_type", filters.type);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.from) query = query.gte("event_date", filters.from);
  if (filters.to) query = query.lte("event_date", filters.to);

  const [eventResult, productionResult, departmentResult, locationResult] = await Promise.all([
    query,
    supabase.from("ghsmta_operations_productions").select("id,name").not("status", "in", "(cancelled,archived)").order("name"),
    supabase.from("ghsmta_operations_departments").select("id,name").eq("active", true).order("sort_order").order("name"),
    supabase.from("ghsmta_operations_locations").select("id,name").eq("active", true).order("name"),
  ]);
  const loadError = eventResult.error || productionResult.error || departmentResult.error || locationResult.error;
  if (loadError) throw new Error(loadError.message);

  const events = (eventResult.data ?? []) as EventRow[];
  const productions = (productionResult.data ?? []) as Option[];
  const departments = (departmentResult.data ?? []) as Option[];
  const locations = (locationResult.data ?? []) as Option[];
  const productionMap = new Map(productions.map((item) => [item.id, item.name]));
  const departmentMap = new Map(departments.map((item) => [item.id, item.name]));
  const locationMap = new Map(locations.map((item) => [item.id, item.name]));

  return (
    <div className="operations-stack">
      <section className="operations-section-heading">
        <div><span className="eyebrow">GHSMTA master calendar</span><h2>Schedule</h2><p>Production events, meetings, deadlines, calls, and department milestones.</p></div>
        <span className="badge">{events.length} events shown</span>
      </section>

      <details className="panel operations-create-panel">
        <summary><span><strong>Add schedule event</strong><small>Create a GHSMTA event, deadline, rehearsal, or performance.</small></span><span aria-hidden="true">＋</span></summary>
        <form action={createScheduleEvent} className="operations-form-grid panel-body">
          <div className="field field-span-2"><label htmlFor="event-title">Event title</label><input className="input" id="event-title" name="title" required /></div>
          <div className="field"><label htmlFor="event-production">Production</label><select className="select" id="event-production" name="production_id"><option value="">General GHSMTA event</option>{productions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="field"><label htmlFor="event-type">Event type</label><select className="select" defaultValue="general" id="event-type" name="event_type">{eventTypes.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
          <div className="field"><label htmlFor="event-date">Date</label><input className="input" defaultValue={dateInput()} id="event-date" name="event_date" required type="date" /></div>
          <div className="field"><label htmlFor="event-start">Start</label><input className="input" id="event-start" name="start_time" type="time" /></div>
          <div className="field"><label htmlFor="event-end">End</label><input className="input" id="event-end" name="end_time" type="time" /></div>
          <div className="field"><label htmlFor="event-status">Status</label><select className="select" defaultValue="scheduled" id="event-status" name="status">{eventStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
          <div className="field"><label htmlFor="event-department">Department</label><select className="select" id="event-department" name="department_id"><option value="">All departments</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="field"><label htmlFor="event-location">Location</label><select className="select" id="event-location" name="location_id"><option value="">Not set</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="field"><label htmlFor="event-visibility">Visibility</label><select className="select" defaultValue="owners" id="event-visibility" name="visibility"><option value="owners">Owners</option><option value="internal">Internal team</option><option value="public">Public</option></select></div>
          <div className="field field-span-2"><label htmlFor="event-description">Description</label><textarea className="textarea" id="event-description" name="description" rows={2} /></div>
          <div className="operations-check-row field-span-2"><label><input name="all_day" type="checkbox" /> All day</label><label><input name="is_deadline" type="checkbox" /> Deadline</label><label><input name="is_announcement" type="checkbox" /> Announcement</label></div>
          <div className="operations-form-actions field-span-2"><button className="button button-primary" type="submit">Add to schedule</button></div>
        </form>
      </details>

      <form className="panel operations-filter-bar" method="get">
        <div className="field"><label htmlFor="filter-production">Production</label><select className="select" defaultValue={filters.production ?? ""} id="filter-production" name="production"><option value="">All productions</option>{productions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="field"><label htmlFor="filter-type">Type</label><select className="select" defaultValue={filters.type ?? ""} id="filter-type" name="type"><option value="">All types</option>{eventTypes.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
        <div className="field"><label htmlFor="filter-status">Status</label><select className="select" defaultValue={filters.status ?? ""} id="filter-status" name="status"><option value="">All statuses</option>{eventStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
        <div className="field"><label htmlFor="filter-from">From</label><input className="input" defaultValue={filters.from ?? ""} id="filter-from" name="from" type="date" /></div>
        <div className="field"><label htmlFor="filter-to">Through</label><input className="input" defaultValue={filters.to ?? ""} id="filter-to" name="to" type="date" /></div>
        <div className="operations-filter-actions"><button className="button button-dark button-compact" type="submit">Apply</button><Link className="button button-secondary button-compact" href="/portal/admin/operations/schedule">Clear</Link></div>
      </form>

      <section className="panel operations-table-panel">
        <div className="operations-table-scroll">
          <table className="data-table operations-table">
            <thead><tr><th>Date</th><th>Event</th><th>Production</th><th>Department</th><th>Location</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {events.length === 0 ? <tr><td colSpan={7}><div className="operations-empty"><strong>No events match these filters</strong><p>Add an event or widen the date and status filters.</p></div></td></tr> : events.map((event) => (
                <tr key={event.id}>
                  <td><strong>{formatDate(event.event_date)}</strong><small>{event.all_day ? "All day" : [formatTime(event.start_time), formatTime(event.end_time)].filter(Boolean).join("–") || "Time not set"}</small></td>
                  <td><strong>{event.title}</strong><small>{label(event.event_type)}{event.is_deadline ? " · Deadline" : ""}</small></td>
                  <td>{event.production_id ? productionMap.get(event.production_id) : "General GHSMTA"}</td>
                  <td>{event.department_id ? departmentMap.get(event.department_id) : "All"}</td>
                  <td>{event.location_id ? locationMap.get(event.location_id) : "—"}</td>
                  <td><span className={`badge badge-${event.status}`}>{label(event.status)}</span></td>
                  <td>
                    <details className="operations-row-menu"><summary>Edit</summary><div className="operations-row-popover">
                      <form action={updateScheduleEvent} className="operations-form-grid operations-compact-form">
                        <input name="event_id" type="hidden" value={event.id} />
                        <div className="field field-span-2"><label>Title</label><input className="input" defaultValue={event.title} name="title" required /></div>
                        <div className="field"><label>Date</label><input className="input" defaultValue={event.event_date} name="event_date" required type="date" /></div>
                        <div className="field"><label>Type</label><select className="select" defaultValue={event.event_type} name="event_type">{eventTypes.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
                        <div className="field"><label>Start</label><input className="input" defaultValue={event.start_time?.slice(0, 5) ?? ""} name="start_time" type="time" /></div>
                        <div className="field"><label>End</label><input className="input" defaultValue={event.end_time?.slice(0, 5) ?? ""} name="end_time" type="time" /></div>
                        <div className="field"><label>Production</label><select className="select" defaultValue={event.production_id ?? ""} name="production_id"><option value="">General GHSMTA</option>{productions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
                        <div className="field"><label>Department</label><select className="select" defaultValue={event.department_id ?? ""} name="department_id"><option value="">All departments</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
                        <div className="field"><label>Location</label><select className="select" defaultValue={event.location_id ?? ""} name="location_id"><option value="">Not set</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
                        <div className="field"><label>Status</label><select className="select" defaultValue={event.status} name="status">{eventStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
                        <div className="field"><label>Visibility</label><select className="select" defaultValue={event.visibility} name="visibility"><option value="owners">Owners</option><option value="internal">Internal team</option><option value="public">Public</option></select></div>
                        <div className="field field-span-2"><label>Description</label><textarea className="textarea" defaultValue={event.description ?? ""} name="description" rows={2} /></div>
                        <div className="operations-check-row field-span-2"><label><input defaultChecked={event.all_day} name="all_day" type="checkbox" /> All day</label><label><input defaultChecked={event.is_deadline} name="is_deadline" type="checkbox" /> Deadline</label><label><input defaultChecked={event.is_announcement} name="is_announcement" type="checkbox" /> Announcement</label></div>
                        <div className="operations-form-actions field-span-2"><button className="button button-primary button-compact" type="submit">Save event</button></div>
                      </form>
                      <div className="operations-secondary-actions">
                        <form action={duplicateScheduleEvent}><input name="event_id" type="hidden" value={event.id} /><button className="button button-secondary button-compact" type="submit">Duplicate</button></form>
                        <form action={deleteScheduleEvent}><input name="event_id" type="hidden" value={event.id} /><ConfirmedSubmitButton className="button button-danger button-compact" destructive description="This permanently removes the schedule event." label="Delete" title={`Delete ${event.title}?`} /></form>
                      </div>
                    </div></details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
