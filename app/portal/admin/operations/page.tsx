import { ConfirmedSubmitButton } from "@/components/confirmed-submit-button";
import { createClient } from "@/lib/supabase/server";

import {
  createOperationsDepartment,
  createOperationsLocation,
  createOperationsProduction,
  deleteOperationsProduction,
  updateOperationsProduction,
} from "./actions";

type Production = {
  id: string;
  cycle_id: string | null;
  name: string;
  code: string | null;
  status: string;
  director: string | null;
  venue: string | null;
  first_rehearsal_date: string | null;
  load_in_date: string | null;
  opening_date: string | null;
  closing_date: string | null;
  notes: string | null;
};

type Cycle = { id: string; name: string; season_year: string };
type Department = { id: string; name: string; sort_order: number; active: boolean };
type Location = { id: string; name: string; location_type: string | null; active: boolean };

const statuses = ["planning", "active", "on_hold", "complete", "cancelled", "archived"];

function title(value: string) {
  return value.replaceAll("_", " ");
}

export default async function ProductionOperationsPage() {
  const supabase = await createClient();
  const [productionResult, cycleResult, departmentResult, locationResult] = await Promise.all([
    supabase
      .from("ghsmta_operations_productions")
      .select("id,cycle_id,name,code,status,director,venue,first_rehearsal_date,load_in_date,opening_date,closing_date,notes")
      .order("opening_date", { ascending: true, nullsFirst: false })
      .order("name"),
    supabase.from("award_cycles").select("id,name,season_year").order("season_year", { ascending: false }),
    supabase
      .from("ghsmta_operations_departments")
      .select("id,name,sort_order,active")
      .order("sort_order")
      .order("name"),
    supabase
      .from("ghsmta_operations_locations")
      .select("id,name,location_type,active")
      .order("name"),
  ]);

  const loadError = productionResult.error || cycleResult.error || departmentResult.error || locationResult.error;
  if (loadError) throw new Error(loadError.message);

  const productions = (productionResult.data ?? []) as Production[];
  const cycles = (cycleResult.data ?? []) as Cycle[];
  const departments = (departmentResult.data ?? []) as Department[];
  const locations = (locationResult.data ?? []) as Location[];

  return (
    <div className="operations-stack">
      <section className="operations-summary-grid" aria-label="Production operations overview">
        <article><span>Productions</span><strong>{productions.length}</strong><small>All GHSMTA internal projects</small></article>
        <article><span>Active</span><strong>{productions.filter((item) => item.status === "active").length}</strong><small>Currently in production</small></article>
        <article><span>Departments</span><strong>{departments.filter((item) => item.active).length}</strong><small>Available for schedules and calls</small></article>
        <article><span>Locations</span><strong>{locations.filter((item) => item.active).length}</strong><small>Saved work and event locations</small></article>
      </section>

      <details className="panel operations-create-panel" open={productions.length === 0}>
        <summary>
          <span><strong>Add a GHSMTA production</strong><small>Create the shared record used by Schedule, Calls, and Budgets.</small></span>
          <span aria-hidden="true">＋</span>
        </summary>
        <form action={createOperationsProduction} className="operations-form-grid panel-body">
          <div className="field field-span-2"><label htmlFor="production-name">Production name</label><input className="input" id="production-name" name="name" required /></div>
          <div className="field"><label htmlFor="production-code">Internal code</label><input className="input" id="production-code" name="code" placeholder="GHSMTA-26" /></div>
          <div className="field"><label htmlFor="production-status">Status</label><select className="select" defaultValue="planning" id="production-status" name="status">{statuses.map((status) => <option key={status} value={status}>{title(status)}</option>)}</select></div>
          <div className="field"><label htmlFor="production-cycle">Awards cycle</label><select className="select" id="production-cycle" name="cycle_id"><option value="">Not linked</option>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.season_year} · {cycle.name}</option>)}</select></div>
          <div className="field"><label htmlFor="production-director">Lead / director</label><input className="input" id="production-director" name="director" /></div>
          <div className="field"><label htmlFor="production-venue">Primary venue</label><input className="input" id="production-venue" name="venue" /></div>
          <div className="field"><label htmlFor="first-rehearsal">First rehearsal</label><input className="input" id="first-rehearsal" name="first_rehearsal_date" type="date" /></div>
          <div className="field"><label htmlFor="load-in">Load-in</label><input className="input" id="load-in" name="load_in_date" type="date" /></div>
          <div className="field"><label htmlFor="opening">Opening</label><input className="input" id="opening" name="opening_date" type="date" /></div>
          <div className="field"><label htmlFor="closing">Closing</label><input className="input" id="closing" name="closing_date" type="date" /></div>
          <div className="field field-span-2"><label htmlFor="production-notes">Notes</label><textarea className="textarea" id="production-notes" name="notes" rows={3} /></div>
          <div className="operations-form-actions field-span-2"><button className="button button-primary" type="submit">Create production</button></div>
        </form>
      </details>

      <section className="panel">
        <div className="panel-header"><div><span className="eyebrow">Shared production directory</span><h2>GHSMTA productions</h2></div><span className="badge">{productions.length} total</span></div>
        <div className="operations-card-list panel-body">
          {productions.length === 0 ? <div className="operations-empty"><strong>No productions yet</strong><p>Create the first GHSMTA production to begin scheduling, calling crew, and budgeting.</p></div> : productions.map((production) => (
            <details className="operations-record" key={production.id}>
              <summary>
                <div><span className={`badge badge-${production.status}`}>{title(production.status)}</span><strong>{production.name}</strong><small>{[production.code, production.venue, production.opening_date].filter(Boolean).join(" · ") || "Dates and venue not set"}</small></div>
                <span className="operations-record-action">Edit</span>
              </summary>
              <form action={updateOperationsProduction} className="operations-form-grid operations-record-body">
                <input name="production_id" type="hidden" value={production.id} />
                <div className="field field-span-2"><label>Production name</label><input className="input" defaultValue={production.name} name="name" required /></div>
                <div className="field"><label>Internal code</label><input className="input" defaultValue={production.code ?? ""} name="code" /></div>
                <div className="field"><label>Status</label><select className="select" defaultValue={production.status} name="status">{statuses.map((status) => <option key={status} value={status}>{title(status)}</option>)}</select></div>
                <div className="field"><label>Awards cycle</label><select className="select" defaultValue={production.cycle_id ?? ""} name="cycle_id"><option value="">Not linked</option>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.season_year} · {cycle.name}</option>)}</select></div>
                <div className="field"><label>Lead / director</label><input className="input" defaultValue={production.director ?? ""} name="director" /></div>
                <div className="field"><label>Primary venue</label><input className="input" defaultValue={production.venue ?? ""} name="venue" /></div>
                <div className="field"><label>First rehearsal</label><input className="input" defaultValue={production.first_rehearsal_date ?? ""} name="first_rehearsal_date" type="date" /></div>
                <div className="field"><label>Load-in</label><input className="input" defaultValue={production.load_in_date ?? ""} name="load_in_date" type="date" /></div>
                <div className="field"><label>Opening</label><input className="input" defaultValue={production.opening_date ?? ""} name="opening_date" type="date" /></div>
                <div className="field"><label>Closing</label><input className="input" defaultValue={production.closing_date ?? ""} name="closing_date" type="date" /></div>
                <div className="field field-span-2"><label>Notes</label><textarea className="textarea" defaultValue={production.notes ?? ""} name="notes" rows={3} /></div>
                <div className="operations-form-actions field-span-2"><button className="button button-primary" type="submit">Save production</button></div>
              </form>
              <form action={deleteOperationsProduction} className="operations-danger-zone">
                <input name="production_id" type="hidden" value={production.id} />
                <ConfirmedSubmitButton className="button button-danger button-compact" destructive description="This permanently removes the production and every connected event, call, assignment, budget line, and transaction." label="Delete production" title={`Delete ${production.name}?`} />
              </form>
            </details>
          ))}
        </div>
      </section>

      <div className="operations-two-column">
        <section className="panel">
          <div className="panel-header"><div><span className="eyebrow">Reusable list</span><h2>Departments</h2></div></div>
          <div className="panel-body operations-lookup-panel">
            <div className="operations-chip-list">{departments.map((department) => <span className="badge" key={department.id}>{department.name}</span>)}</div>
            <form action={createOperationsDepartment} className="operations-inline-form"><input className="input" name="name" placeholder="Department name" required /><input className="input" defaultValue="90" min="0" name="sort_order" type="number" /><button className="button button-primary button-compact" type="submit">Add</button></form>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><div><span className="eyebrow">Reusable list</span><h2>Locations</h2></div></div>
          <div className="panel-body operations-lookup-panel">
            <div className="operations-chip-list">{locations.length ? locations.map((location) => <span className="badge" key={location.id}>{location.name}</span>) : <span className="operations-muted">No saved locations yet.</span>}</div>
            <form action={createOperationsLocation} className="operations-inline-form operations-location-form"><input className="input" name="name" placeholder="Location name" required /><input className="input" name="location_type" placeholder="Type" /><input className="input" name="address" placeholder="Address" /><button className="button button-primary button-compact" type="submit">Add</button></form>
          </div>
        </section>
      </div>
    </div>
  );
}
