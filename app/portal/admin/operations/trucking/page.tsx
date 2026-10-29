import Link from "next/link";

import { ConfirmedSubmitButton } from "@/components/confirmed-submit-button";
import { OperationsExportMenu } from "@/components/operations-export-menu";
import { createClient } from "@/lib/supabase/server";

import {
  createTruckMove,
  createTruckStop,
  createTruckVehicle,
  deleteTruckMove,
  deleteTruckStop,
  deleteTruckVehicle,
  duplicateTruckMove,
  updateTruckMove,
  updateTruckStop,
  updateTruckVehicle,
} from "../actions";

type SearchParams = {
  production?: string;
  status?: string;
  from?: string;
  to?: string;
};

type NamedOption = { id: string; name: string };
type ProfileOption = { id: string; full_name: string | null; email: string | null };
type Vehicle = {
  id: string;
  vehicle_name: string;
  vehicle_type: string | null;
  plate_number: string | null;
  current_location: string | null;
  door_type: string | null;
  capacity_notes: string | null;
  notes: string | null;
  active: boolean;
  sort_order: number;
};
type TruckMove = {
  id: string;
  production_id: string | null;
  move_title: string;
  move_type: string;
  move_status: string;
  priority: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  truck_vehicle_id: string | null;
  driver_profile_id: string | null;
  driver_name: string | null;
  internal_notes: string | null;
  public_notes: string | null;
};
type TruckStop = {
  id: string;
  truck_move_id: string;
  stop_order: number;
  stop_type: string;
  action_label: string | null;
  location_id: string | null;
  custom_location_name: string | null;
  custom_address: string | null;
  scheduled_arrival: string | null;
  scheduled_departure: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  stop_notes: string | null;
  trailer_label: string | null;
  show_on_schedule: boolean;
  is_complete: boolean;
  driver_profile_id: string | null;
  driver_name: string | null;
  truck_vehicle_id: string | null;
};

const moveTypes = [
  "pickup",
  "delivery",
  "transfer",
  "return",
  "strike",
  "shop_run",
  "vendor_run",
  "storage_run",
  "rental_pickup",
  "rental_return",
  "other",
];
const moveStatuses = [
  "draft",
  "requested",
  "approved",
  "scheduled",
  "loading",
  "in_transit",
  "delivered",
  "completed",
  "cancelled",
];
const priorities = ["low", "normal", "high", "urgent"];
function dateInput(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
const stopTypes = [
  "pickup",
  "delivery",
  "stop",
  "return",
  "storage",
  "vendor",
  "shop",
  "other",
];

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function profileLabel(profile: ProfileOption) {
  return profile.full_name ?? profile.email ?? "Portal user";
}

function formatDateTime(value: string | null) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function localInputValue(value: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export default async function OperationsTruckingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = await searchParams;
  const supabase = await createClient();
  let moveQuery = supabase
    .from("ghsmta_operations_truck_moves")
    .select(
      "id,production_id,move_title,move_type,move_status,priority,scheduled_start,scheduled_end,truck_vehicle_id,driver_profile_id,driver_name,internal_notes,public_notes",
    )
    .order("scheduled_start", { ascending: true, nullsFirst: false });
  if (filters.production) moveQuery = moveQuery.eq("production_id", filters.production);
  if (filters.status) moveQuery = moveQuery.eq("move_status", filters.status);
  if (filters.from) moveQuery = moveQuery.gte("scheduled_start", `${filters.from}T00:00:00-04:00`);
  if (filters.to) moveQuery = moveQuery.lte("scheduled_start", `${filters.to}T23:59:59-04:00`);

  const [moveResult, stopResult, vehicleResult, productionResult, locationResult, profileResult] =
    await Promise.all([
      moveQuery,
      supabase
        .from("ghsmta_operations_truck_stops")
        .select(
          "id,truck_move_id,stop_order,stop_type,action_label,location_id,custom_location_name,custom_address,scheduled_arrival,scheduled_departure,contact_name,contact_phone,contact_email,stop_notes,trailer_label,show_on_schedule,is_complete,driver_profile_id,driver_name,truck_vehicle_id",
        )
        .order("stop_order")
        .order("scheduled_arrival", { nullsFirst: false }),
      supabase
        .from("ghsmta_operations_truck_vehicles")
        .select(
          "id,vehicle_name,vehicle_type,plate_number,current_location,door_type,capacity_notes,notes,active,sort_order",
        )
        .order("sort_order")
        .order("vehicle_name"),
      supabase
        .from("ghsmta_operations_productions")
        .select("id,name")
        .not("status", "in", "(cancelled,archived)")
        .order("name"),
      supabase
        .from("ghsmta_operations_locations")
        .select("id,name")
        .eq("active", true)
        .order("name"),
      supabase
        .from("profiles")
        .select("id,full_name,email")
        .eq("active", true)
        .order("full_name"),
    ]);
  const loadError =
    moveResult.error ||
    stopResult.error ||
    vehicleResult.error ||
    productionResult.error ||
    locationResult.error ||
    profileResult.error;
  if (loadError) throw new Error(loadError.message);

  const moves = (moveResult.data ?? []) as TruckMove[];
  const stops = (stopResult.data ?? []) as TruckStop[];
  const vehicles = (vehicleResult.data ?? []) as Vehicle[];
  const productions = (productionResult.data ?? []) as NamedOption[];
  const locations = (locationResult.data ?? []) as NamedOption[];
  const profiles = (profileResult.data ?? []) as ProfileOption[];
  const productionMap = new Map(productions.map((item) => [item.id, item.name]));
  const locationMap = new Map(locations.map((item) => [item.id, item.name]));
  const vehicleMap = new Map(vehicles.map((item) => [item.id, item.vehicle_name]));
  const profileMap = new Map(profiles.map((item) => [item.id, profileLabel(item)]));
  const stopsByMove = new Map<string, TruckStop[]>();
  stops.forEach((stop) => {
    const current = stopsByMove.get(stop.truck_move_id) ?? [];
    current.push(stop);
    stopsByMove.set(stop.truck_move_id, current);
  });
  const activeMoves = moves.filter(
    (move) => !["completed", "cancelled"].includes(move.move_status),
  ).length;

  return (
    <div className="operations-stack">
      <section className="operations-section-heading">
        <div>
          <span className="eyebrow">GHSMTA transportation logistics</span>
          <h2>Trucking</h2>
          <p>
            Coordinate truck moves, vehicles, drivers, pickups, deliveries, and
            every route stop.
          </p>
        </div>
        <span className="badge">{moves.length} moves shown</span>
      </section>

      <OperationsExportMenu
        description="GHSMTA daily trucking and trailer reports."
        options={[
          { label: "Daily Trucking PDF", module: "trucking", format: "pdf", variant: "schedule", query: { date: filters.from || dateInput() } },
          { label: "Tomorrow Trucking PDF", module: "trucking", format: "pdf", variant: "schedule", query: { date: dateInput(1) } },
          { label: "Current View CSV", module: "trucking", format: "csv", variant: "schedule", query: { production: filters.production, date: filters.from } },
          { label: "Trailer Report PDF", module: "trucking", format: "pdf", variant: "vehicles" },
          { label: "Trailer Report - All PDF", module: "trucking", format: "pdf", variant: "vehicles", query: { includeHidden: "true" } },
        ]}
      />

      <section className="operations-summary-grid">
        <article><span>Active moves</span><strong>{activeMoves}</strong><small>Not completed or cancelled</small></article>
        <article><span>In transit</span><strong>{moves.filter((move) => move.move_status === "in_transit").length}</strong><small>Currently on the road</small></article>
        <article><span>Active vehicles</span><strong>{vehicles.filter((vehicle) => vehicle.active).length}</strong><small>Available fleet records</small></article>
        <article><span>Route stops</span><strong>{stops.length}</strong><small>{stops.filter((stop) => stop.is_complete).length} complete</small></article>
      </section>

      <details className="panel operations-create-panel">
        <summary><span><strong>Add truck move</strong><small>Create a pickup, delivery, transfer, return, strike, or run.</small></span><span aria-hidden="true">＋</span></summary>
        <form action={createTruckMove} className="operations-form-grid panel-body">
          <div className="field field-span-2"><label htmlFor="move-title">Move title</label><input className="input" id="move-title" name="move_title" required /></div>
          <div className="field"><label htmlFor="move-production">Production</label><select className="select" id="move-production" name="production_id"><option value="">General GHSMTA</option>{productions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="field"><label htmlFor="move-type">Move type</label><select className="select" defaultValue="delivery" id="move-type" name="move_type">{moveTypes.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
          <div className="field"><label htmlFor="move-status">Status</label><select className="select" defaultValue="draft" id="move-status" name="move_status">{moveStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
          <div className="field"><label htmlFor="move-priority">Priority</label><select className="select" defaultValue="normal" id="move-priority" name="priority">{priorities.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
          <div className="field"><label htmlFor="move-start">Scheduled start</label><input className="input" id="move-start" name="scheduled_start" type="datetime-local" /></div>
          <div className="field"><label htmlFor="move-end">Scheduled end</label><input className="input" id="move-end" name="scheduled_end" type="datetime-local" /></div>
          <div className="field"><label htmlFor="move-vehicle">Vehicle</label><select className="select" id="move-vehicle" name="truck_vehicle_id"><option value="">Unassigned</option>{vehicles.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.vehicle_name}</option>)}</select></div>
          <div className="field"><label htmlFor="move-driver">Portal driver</label><select className="select" id="move-driver" name="driver_profile_id"><option value="">Unassigned</option>{profiles.map((item) => <option key={item.id} value={item.id}>{profileLabel(item)}</option>)}</select></div>
          <div className="field field-span-2"><label htmlFor="move-driver-name">External driver name</label><input className="input" id="move-driver-name" name="driver_name" placeholder="Use when the driver does not have a portal account" /></div>
          <div className="field"><label htmlFor="move-public-notes">Schedule notes</label><textarea className="textarea" id="move-public-notes" name="public_notes" rows={3} /></div>
          <div className="field"><label htmlFor="move-internal-notes">Internal notes</label><textarea className="textarea" id="move-internal-notes" name="internal_notes" rows={3} /></div>
          <div className="operations-form-actions field-span-2"><button className="button button-primary" type="submit">Create truck move</button></div>
        </form>
      </details>

      <details className="panel operations-create-panel">
        <summary><span><strong>Vehicle manager</strong><small>Add and maintain trucks, vans, trailers, and rental vehicles.</small></span><span aria-hidden="true">＋</span></summary>
        <div className="panel-body operations-stack">
          <form action={createTruckVehicle} className="operations-form-grid">
            <div className="field"><label>Vehicle name</label><input className="input" name="vehicle_name" required /></div>
            <div className="field"><label>Type</label><input className="input" name="vehicle_type" placeholder="Box truck, van, trailer…" /></div>
            <div className="field"><label>Plate or unit number</label><input className="input" name="plate_number" /></div>
            <div className="field"><label>Current location</label><input className="input" name="current_location" /></div>
            <div className="field"><label>Door type</label><input className="input" name="door_type" placeholder="Liftgate, roll-up…" /></div>
            <div className="field"><label>Sort order</label><input className="input" defaultValue="0" min="0" name="sort_order" type="number" /></div>
            <div className="field field-span-2"><label>Capacity notes</label><input className="input" name="capacity_notes" /></div>
            <div className="operations-form-actions field-span-2"><button className="button button-primary" type="submit">Add vehicle</button></div>
          </form>
          <div className="operations-card-list">
            {vehicles.length === 0 ? <div className="operations-empty"><strong>No vehicles added</strong><p>Add the first fleet or rental vehicle above.</p></div> : vehicles.map((vehicle) => (
              <details className="operations-record" key={vehicle.id}>
                <summary><div><strong>{vehicle.vehicle_name}</strong><span className={`badge ${vehicle.active ? "badge-active" : "badge-archived"}`}>{vehicle.active ? "Active" : "Inactive"}</span><small>{[vehicle.vehicle_type, vehicle.plate_number, vehicle.current_location].filter(Boolean).join(" · ") || "Vehicle details not set"}</small></div><span className="operations-record-action">Edit</span></summary>
                <div className="operations-record-body">
                  <form action={updateTruckVehicle} className="operations-form-grid">
                    <input name="vehicle_id" type="hidden" value={vehicle.id} />
                    <div className="field"><label>Vehicle name</label><input className="input" defaultValue={vehicle.vehicle_name} name="vehicle_name" required /></div>
                    <div className="field"><label>Type</label><input className="input" defaultValue={vehicle.vehicle_type ?? ""} name="vehicle_type" /></div>
                    <div className="field"><label>Plate or unit number</label><input className="input" defaultValue={vehicle.plate_number ?? ""} name="plate_number" /></div>
                    <div className="field"><label>Current location</label><input className="input" defaultValue={vehicle.current_location ?? ""} name="current_location" /></div>
                    <div className="field"><label>Door type</label><input className="input" defaultValue={vehicle.door_type ?? ""} name="door_type" /></div>
                    <div className="field"><label>Sort order</label><input className="input" defaultValue={vehicle.sort_order} min="0" name="sort_order" type="number" /></div>
                    <div className="field field-span-2"><label>Capacity notes</label><input className="input" defaultValue={vehicle.capacity_notes ?? ""} name="capacity_notes" /></div>
                    <div className="field field-span-2"><label>Internal notes</label><textarea className="textarea" defaultValue={vehicle.notes ?? ""} name="notes" rows={2} /></div>
                    <div className="operations-check-row"><label><input defaultChecked={vehicle.active} name="active" type="checkbox" /> Active</label></div>
                    <div className="operations-form-actions"><button className="button button-primary button-compact" type="submit">Save vehicle</button></div>
                  </form>
                  <form action={deleteTruckVehicle} className="operations-inline-delete"><input name="vehicle_id" type="hidden" value={vehicle.id} /><ConfirmedSubmitButton className="button button-danger button-compact" destructive description="Existing moves and stops will retain their records but become unassigned." label="Delete vehicle" title={`Delete ${vehicle.vehicle_name}?`} /></form>
                </div>
              </details>
            ))}
          </div>
        </div>
      </details>

      <form className="panel operations-filter-bar" method="get">
        <div className="field"><label htmlFor="truck-filter-production">Production</label><select className="select" defaultValue={filters.production ?? ""} id="truck-filter-production" name="production"><option value="">All productions</option>{productions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="field"><label htmlFor="truck-filter-status">Status</label><select className="select" defaultValue={filters.status ?? ""} id="truck-filter-status" name="status"><option value="">All statuses</option>{moveStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
        <div className="field"><label htmlFor="truck-filter-from">From</label><input className="input" defaultValue={filters.from ?? ""} id="truck-filter-from" name="from" type="date" /></div>
        <div className="field"><label htmlFor="truck-filter-to">Through</label><input className="input" defaultValue={filters.to ?? ""} id="truck-filter-to" name="to" type="date" /></div>
        <div className="operations-filter-actions"><button className="button button-dark button-compact" type="submit">Apply</button><Link className="button button-secondary button-compact" href="/portal/admin/operations/trucking">Clear</Link></div>
      </form>

      <section className="operations-card-list" aria-label="Truck moves">
        {moves.length === 0 ? (
          <div className="panel operations-empty"><strong>No truck moves match these filters</strong><p>Create a move or widen the production, status, and date filters.</p></div>
        ) : moves.map((move) => {
          const moveStops = stopsByMove.get(move.id) ?? [];
          const driver = move.driver_profile_id ? profileMap.get(move.driver_profile_id) : move.driver_name;
          return (
            <details className="operations-record" key={move.id}>
              <summary>
                <div><strong>{move.move_title}</strong><span className={`badge badge-${move.move_status}`}>{label(move.move_status)}</span><small>{formatDateTime(move.scheduled_start)} · {productionMap.get(move.production_id ?? "") ?? "General GHSMTA"} · {moveStops.length} stops</small></div>
                <span className="operations-record-action">Open route</span>
              </summary>
              <div className="operations-record-body operations-stack">
                <div className="operations-trucking-meta">
                  <span><small>Vehicle</small><strong>{vehicleMap.get(move.truck_vehicle_id ?? "") ?? "Unassigned"}</strong></span>
                  <span><small>Driver</small><strong>{driver ?? "Unassigned"}</strong></span>
                  <span><small>Priority</small><strong>{label(move.priority)}</strong></span>
                  <span><small>Scheduled end</small><strong>{formatDateTime(move.scheduled_end)}</strong></span>
                </div>

                <details className="panel operations-create-panel">
                  <summary><span><strong>Edit move</strong><small>Update timing, assignments, status, and notes.</small></span><span aria-hidden="true">＋</span></summary>
                  <form action={updateTruckMove} className="operations-form-grid panel-body">
                    <input name="move_id" type="hidden" value={move.id} />
                    <div className="field field-span-2"><label>Move title</label><input className="input" defaultValue={move.move_title} name="move_title" required /></div>
                    <div className="field"><label>Production</label><select className="select" defaultValue={move.production_id ?? ""} name="production_id"><option value="">General GHSMTA</option>{productions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
                    <div className="field"><label>Move type</label><select className="select" defaultValue={move.move_type} name="move_type">{moveTypes.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
                    <div className="field"><label>Status</label><select className="select" defaultValue={move.move_status} name="move_status">{moveStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
                    <div className="field"><label>Priority</label><select className="select" defaultValue={move.priority} name="priority">{priorities.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
                    <div className="field"><label>Scheduled start</label><input className="input" defaultValue={localInputValue(move.scheduled_start)} name="scheduled_start" type="datetime-local" /></div>
                    <div className="field"><label>Scheduled end</label><input className="input" defaultValue={localInputValue(move.scheduled_end)} name="scheduled_end" type="datetime-local" /></div>
                    <div className="field"><label>Vehicle</label><select className="select" defaultValue={move.truck_vehicle_id ?? ""} name="truck_vehicle_id"><option value="">Unassigned</option>{vehicles.map((item) => <option key={item.id} value={item.id}>{item.vehicle_name}</option>)}</select></div>
                    <div className="field"><label>Portal driver</label><select className="select" defaultValue={move.driver_profile_id ?? ""} name="driver_profile_id"><option value="">Unassigned</option>{profiles.map((item) => <option key={item.id} value={item.id}>{profileLabel(item)}</option>)}</select></div>
                    <div className="field field-span-2"><label>External driver name</label><input className="input" defaultValue={move.driver_name ?? ""} name="driver_name" /></div>
                    <div className="field"><label>Schedule notes</label><textarea className="textarea" defaultValue={move.public_notes ?? ""} name="public_notes" rows={3} /></div>
                    <div className="field"><label>Internal notes</label><textarea className="textarea" defaultValue={move.internal_notes ?? ""} name="internal_notes" rows={3} /></div>
                    <div className="operations-form-actions field-span-2"><button className="button button-primary button-compact" type="submit">Save move</button></div>
                  </form>
                </details>

                <section className="operations-route-section">
                  <div className="operations-section-heading"><div><span className="eyebrow">Route plan</span><h3>{moveStops.length} stops</h3></div></div>
                  <div className="operations-route-list">
                    {moveStops.length === 0 ? <div className="operations-empty"><strong>No stops added</strong><p>Add the first pickup, delivery, or route stop below.</p></div> : moveStops.map((stop) => (
                      <details className="operations-route-stop" key={stop.id}>
                        <summary><span className="operations-stop-order">{stop.stop_order || "—"}</span><span><strong>{stop.action_label || label(stop.stop_type)}</strong><small>{stop.location_id ? locationMap.get(stop.location_id) : stop.custom_location_name || "Location not set"} · {formatDateTime(stop.scheduled_arrival)}</small></span><span className={`badge ${stop.is_complete ? "badge-complete" : "badge-scheduled"}`}>{stop.is_complete ? "Complete" : "Planned"}</span></summary>
                        <div className="operations-record-body">
                          <form action={updateTruckStop} className="operations-form-grid">
                            <input name="stop_id" type="hidden" value={stop.id} />
                            <div className="field"><label>Stop order</label><input className="input" defaultValue={stop.stop_order} min="0" name="stop_order" type="number" /></div>
                            <div className="field"><label>Stop type</label><select className="select" defaultValue={stop.stop_type} name="stop_type">{stopTypes.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
                            <div className="field field-span-2"><label>Action label</label><input className="input" defaultValue={stop.action_label ?? ""} name="action_label" placeholder="What happens at this stop?" /></div>
                            <div className="field"><label>Saved location</label><select className="select" defaultValue={stop.location_id ?? ""} name="location_id"><option value="">Custom location</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
                            <div className="field"><label>Custom location name</label><input className="input" defaultValue={stop.custom_location_name ?? ""} name="custom_location_name" /></div>
                            <div className="field field-span-2"><label>Address</label><input className="input" defaultValue={stop.custom_address ?? ""} name="custom_address" /></div>
                            <div className="field"><label>Arrival</label><input className="input" defaultValue={localInputValue(stop.scheduled_arrival)} name="scheduled_arrival" type="datetime-local" /></div>
                            <div className="field"><label>Departure</label><input className="input" defaultValue={localInputValue(stop.scheduled_departure)} name="scheduled_departure" type="datetime-local" /></div>
                            <div className="field"><label>Vehicle</label><select className="select" defaultValue={stop.truck_vehicle_id ?? ""} name="truck_vehicle_id"><option value="">Use move vehicle</option>{vehicles.map((item) => <option key={item.id} value={item.id}>{item.vehicle_name}</option>)}</select></div>
                            <div className="field"><label>Portal driver</label><select className="select" defaultValue={stop.driver_profile_id ?? ""} name="driver_profile_id"><option value="">Use move driver</option>{profiles.map((item) => <option key={item.id} value={item.id}>{profileLabel(item)}</option>)}</select></div>
                            <div className="field"><label>External driver</label><input className="input" defaultValue={stop.driver_name ?? ""} name="driver_name" /></div>
                            <div className="field"><label>Trailer or load label</label><input className="input" defaultValue={stop.trailer_label ?? ""} name="trailer_label" /></div>
                            <div className="field"><label>Contact name</label><input className="input" defaultValue={stop.contact_name ?? ""} name="contact_name" /></div>
                            <div className="field"><label>Contact phone</label><input className="input" defaultValue={stop.contact_phone ?? ""} name="contact_phone" type="tel" /></div>
                            <div className="field field-span-2"><label>Contact email</label><input className="input" defaultValue={stop.contact_email ?? ""} name="contact_email" type="email" /></div>
                            <div className="field field-span-2"><label>Stop notes</label><textarea className="textarea" defaultValue={stop.stop_notes ?? ""} name="stop_notes" rows={2} /></div>
                            <div className="operations-check-row field-span-2"><label><input defaultChecked={stop.show_on_schedule} name="show_on_schedule" type="checkbox" /> Show on schedule</label><label><input defaultChecked={stop.is_complete} name="is_complete" type="checkbox" /> Complete</label></div>
                            <div className="operations-form-actions field-span-2"><button className="button button-primary button-compact" type="submit">Save stop</button></div>
                          </form>
                          <form action={deleteTruckStop} className="operations-inline-delete"><input name="stop_id" type="hidden" value={stop.id} /><ConfirmedSubmitButton className="button button-danger button-compact" destructive description="This permanently removes the route stop." label="Delete stop" title="Delete this route stop?" /></form>
                        </div>
                      </details>
                    ))}
                  </div>
                  <details className="panel operations-create-panel">
                    <summary><span><strong>Add route stop</strong><small>Schedule a pickup, delivery, vendor, storage, shop, or custom stop.</small></span><span aria-hidden="true">＋</span></summary>
                    <form action={createTruckStop} className="operations-form-grid panel-body">
                      <input name="move_id" type="hidden" value={move.id} />
                      <div className="field"><label>Stop order</label><input className="input" defaultValue={moveStops.length + 1} min="0" name="stop_order" type="number" /></div>
                      <div className="field"><label>Stop type</label><select className="select" defaultValue="stop" name="stop_type">{stopTypes.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div>
                      <div className="field field-span-2"><label>Action label</label><input className="input" name="action_label" placeholder="Load scenery, return rental, unload cases…" /></div>
                      <div className="field"><label>Saved location</label><select className="select" name="location_id"><option value="">Custom location</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
                      <div className="field"><label>Custom location name</label><input className="input" name="custom_location_name" /></div>
                      <div className="field field-span-2"><label>Address</label><input className="input" name="custom_address" /></div>
                      <div className="field"><label>Arrival</label><input className="input" name="scheduled_arrival" type="datetime-local" /></div>
                      <div className="field"><label>Departure</label><input className="input" name="scheduled_departure" type="datetime-local" /></div>
                      <div className="field"><label>Vehicle</label><select className="select" defaultValue={move.truck_vehicle_id ?? ""} name="truck_vehicle_id"><option value="">Use move vehicle</option>{vehicles.map((item) => <option key={item.id} value={item.id}>{item.vehicle_name}</option>)}</select></div>
                      <div className="field"><label>Portal driver</label><select className="select" defaultValue={move.driver_profile_id ?? ""} name="driver_profile_id"><option value="">Use move driver</option>{profiles.map((item) => <option key={item.id} value={item.id}>{profileLabel(item)}</option>)}</select></div>
                      <div className="field"><label>External driver</label><input className="input" defaultValue={move.driver_name ?? ""} name="driver_name" /></div>
                      <div className="field"><label>Trailer or load label</label><input className="input" name="trailer_label" /></div>
                      <div className="field"><label>Contact name</label><input className="input" name="contact_name" /></div>
                      <div className="field"><label>Contact phone</label><input className="input" name="contact_phone" type="tel" /></div>
                      <div className="field field-span-2"><label>Contact email</label><input className="input" name="contact_email" type="email" /></div>
                      <div className="field field-span-2"><label>Stop notes</label><textarea className="textarea" name="stop_notes" rows={2} /></div>
                      <div className="operations-check-row field-span-2"><label><input defaultChecked name="show_on_schedule" type="checkbox" /> Show on schedule</label><label><input name="is_complete" type="checkbox" /> Complete</label></div>
                      <div className="operations-form-actions field-span-2"><button className="button button-primary button-compact" type="submit">Add stop</button></div>
                    </form>
                  </details>
                </section>

                <div className="operations-secondary-actions">
                  <form action={duplicateTruckMove}><input name="move_id" type="hidden" value={move.id} /><button className="button button-secondary button-compact" type="submit">Duplicate move and stops</button></form>
                  <form action={deleteTruckMove}><input name="move_id" type="hidden" value={move.id} /><ConfirmedSubmitButton className="button button-danger button-compact" destructive description="This permanently removes the truck move and every route stop." label="Delete move" title={`Delete ${move.move_title}?`} /></form>
                </div>
              </div>
            </details>
          );
        })}
      </section>
    </div>
  );
}
