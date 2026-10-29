import { NextResponse } from "next/server";

import { requireProfile } from "@/lib/auth";
import {
  buildReportCsv,
  reportFilename,
} from "@/lib/reports/report-export";
import type { LoadedReport, ReportRow } from "@/lib/reports/report-data";
import type { ReportColumn, ReportDefinition } from "@/lib/reports/report-definitions";
import { buildOperationsProductionPdf } from "@/lib/reports/operations-production-pdf";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OperationsModule = "productions" | "schedule" | "calls" | "budgets" | "trucking";
type DataRow = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "");
}

function label(value: unknown) {
  return text(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function dateTime(value: unknown) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(text(value)));
}

function dateOnly(value: unknown) {
  if (!value) return "";
  const raw = text(value);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${raw.slice(0, 10)}T12:00:00Z`));
}

function timeOnly(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const [hourText, minute = "00"] = raw.split(":");
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function easternDateKey(value: unknown) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(text(value)));
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${mapped.year}-${mapped.month}-${mapped.day}`;
}

function mapById(rows: DataRow[], valueKey: string) {
  return new Map(rows.map((row) => [text(row.id), text(row[valueKey])]));
}

function definition(id: string, title: string, columns: ReportColumn[]): ReportDefinition {
  return {
    id,
    title,
    description: `${title} exported from GHSMTA Production Operations.`,
    category: "Scheduling",
    source: "schedule",
    formats: ["pdf", "csv"],
    allowedRoles: ["owner"],
    columns,
    supportsExternalVariant: false,
    confidentialityNote: "Owner-only GHSMTA production operations report.",
  };
}

function report(id: string, title: string, columns: ReportColumn[], rows: ReportRow[]): LoadedReport {
  return {
    definition: definition(id, title, columns),
    columns,
    rows,
    filters: {
      cycleId: "",
      dateFrom: "",
      dateTo: "",
      school: "",
      status: "",
      format: "pdf",
      variant: "internal",
      includeArchived: true,
      includeInternalNotes: true,
      includeContactInfo: true,
      includeAdjudicatorIdentities: false,
      includeProtectedScores: false,
      sort: "",
      direction: "asc",
    },
    warnings: [],
    generatedAt: new Date().toISOString(),
  };
}

async function loadProductions(): Promise<LoadedReport> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ghsmta_operations_productions")
    .select("name,code,status,director,venue,first_rehearsal_date,load_in_date,opening_date,closing_date,notes")
    .order("opening_date", { nullsFirst: false })
    .order("name");
  if (error) throw new Error(error.message);
  const columns = [
    { key: "production", label: "Production" },
    { key: "code", label: "Code" },
    { key: "status", label: "Status" },
    { key: "lead", label: "Lead / Director" },
    { key: "venue", label: "Venue" },
    { key: "first_rehearsal", label: "First Rehearsal" },
    { key: "load_in", label: "Load-In" },
    { key: "opening", label: "Opening" },
    { key: "closing", label: "Closing" },
    { key: "notes", label: "Notes" },
  ];
  const rows = ((data ?? []) as DataRow[]).map((row) => ({
    production: text(row.name),
    code: text(row.code),
    status: label(row.status),
    lead: text(row.director),
    venue: text(row.venue),
    first_rehearsal: dateOnly(row.first_rehearsal_date),
    load_in: dateOnly(row.load_in_date),
    opening: dateOnly(row.opening_date),
    closing: dateOnly(row.closing_date),
    notes: text(row.notes),
  }));
  return report("production-directory", "GHSMTA Production Directory", columns, rows);
}

async function loadSchedule(params: URLSearchParams): Promise<LoadedReport> {
  const supabase = await createClient();
  const variant = params.get("variant") || "daily";
  const productionId = params.get("production") || "";
  const date = params.get("date") || "";
  const from = params.get("from") || date;
  const to = params.get("to") || date;
  let query = supabase
    .from("ghsmta_operations_schedule_events")
    .select("production_id,department_id,location_id,title,event_type,status,event_date,start_time,end_time,all_day,is_deadline,description,notes")
    .order("event_date")
    .order("start_time", { nullsFirst: false });
  if (productionId) query = query.eq("production_id", productionId);
  if (from) query = query.gte("event_date", from);
  if (to) query = query.lte("event_date", to);
  const [eventsResult, productionsResult, departmentsResult, locationsResult] = await Promise.all([
    query,
    supabase.from("ghsmta_operations_productions").select("id,name"),
    supabase.from("ghsmta_operations_departments").select("id,name"),
    supabase.from("ghsmta_operations_locations").select("id,name"),
  ]);
  const error = eventsResult.error || productionsResult.error || departmentsResult.error || locationsResult.error;
  if (error) throw new Error(error.message);
  const productions = mapById((productionsResult.data ?? []) as DataRow[], "name");
  const departments = mapById((departmentsResult.data ?? []) as DataRow[], "name");
  const locations = mapById((locationsResult.data ?? []) as DataRow[], "name");
  const columns = [
    { key: "date", label: "Date" },
    { key: "time", label: "Time" },
    { key: "event", label: "Event" },
    { key: "production", label: "Production" },
    { key: "department", label: "Department" },
    { key: "location", label: "Location" },
    { key: "type", label: "Type" },
    { key: "status", label: "Status" },
    { key: "description", label: "Description" },
    { key: "notes", label: "Internal Notes" },
  ];
  const rows = ((eventsResult.data ?? []) as DataRow[]).map((row) => ({
    date: dateOnly(row.event_date),
    time: row.all_day ? "All day" : [timeOnly(row.start_time), timeOnly(row.end_time)].filter(Boolean).join(" - "),
    event: text(row.title),
    production: productions.get(text(row.production_id)) || "General GHSMTA",
    department: departments.get(text(row.department_id)) || "All departments",
    location: locations.get(text(row.location_id)) || "",
    type: label(row.event_type),
    status: label(row.status),
    description: text(row.description),
    notes: text(row.notes),
  }));
  const title = variant === "advance" ? "GHSMTA Advance Production Schedule" : variant === "csv" ? "GHSMTA Production Schedule" : "GHSMTA Daily Production Schedule";
  return report(`production-schedule-${variant}`, title, columns, rows);
}

async function loadCalls(params: URLSearchParams): Promise<LoadedReport> {
  const supabase = await createClient();
  const variant = params.get("variant") || "call-sheet";
  const productionId = params.get("production") || "";
  const callId = params.get("callId") || "";
  let callQuery = supabase
    .from("ghsmta_operations_calls")
    .select("id,production_id,location_id,call_date,start_time,end_time,meal_1_start,meal_1_end,meal_2_start,meal_2_end,call_type,status,description,notes,original_budget,is_final")
    .order("call_date")
    .order("start_time", { nullsFirst: false });
  if (productionId) callQuery = callQuery.eq("production_id", productionId);
  if (callId) callQuery = callQuery.eq("id", callId);
  const [callsResult, assignmentsResult, productionsResult, locationsResult, departmentsResult, profilesResult] = await Promise.all([
    callQuery,
    supabase.from("ghsmta_operations_call_assignments").select("call_id,profile_id,department_id,crew_name,job_title,employment_type,assignment_status,time_1_start,time_1_end,time_2_start,time_2_end,time_3_start,time_3_end,hourly_rate,flat_rate,estimated_hours,actual_hours,estimated_pay,actual_pay,notes"),
    supabase.from("ghsmta_operations_productions").select("id,name"),
    supabase.from("ghsmta_operations_locations").select("id,name"),
    supabase.from("ghsmta_operations_departments").select("id,name"),
    supabase.from("profiles").select("id,full_name,email"),
  ]);
  const error = callsResult.error || assignmentsResult.error || productionsResult.error || locationsResult.error || departmentsResult.error || profilesResult.error;
  if (error) throw new Error(error.message);
  const calls = (callsResult.data ?? []) as DataRow[];
  const callIds = new Set(calls.map((row) => text(row.id)));
  const assignments = ((assignmentsResult.data ?? []) as DataRow[]).filter((row) => callIds.has(text(row.call_id)));
  const productions = mapById((productionsResult.data ?? []) as DataRow[], "name");
  const locations = mapById((locationsResult.data ?? []) as DataRow[], "name");
  const departments = mapById((departmentsResult.data ?? []) as DataRow[], "name");
  const profiles = new Map(((profilesResult.data ?? []) as DataRow[]).map((row) => [text(row.id), text(row.full_name) || text(row.email)]));
  const callMap = new Map(calls.map((row) => [text(row.id), row]));

  if (["payroll", "daily-payroll", "weekly-payroll"].includes(variant)) {
    const columns = [
      { key: "date", label: "Date" }, { key: "call", label: "Call" },
      { key: "production", label: "Production" }, { key: "person", label: "Person / Position" },
      { key: "department", label: "Department" }, { key: "job", label: "Job" },
      { key: "sessions", label: "Work Sessions" }, { key: "rate", label: "Rate" },
      { key: "estimated", label: "Estimated Pay" }, { key: "actual", label: "Actual Pay" },
    ];
    const rows = assignments.map((assignment) => {
      const call = callMap.get(text(assignment.call_id)) ?? {};
      const sessions = [[assignment.time_1_start, assignment.time_1_end], [assignment.time_2_start, assignment.time_2_end], [assignment.time_3_start, assignment.time_3_end]]
        .filter(([start]) => Boolean(start))
        .map(([start, end]) => `${timeOnly(start)}-${timeOnly(end) || "?"}`)
        .join(" / ");
      const rate = Number(assignment.flat_rate || 0) > 0 ? `${money(assignment.flat_rate)} flat` : Number(assignment.hourly_rate || 0) > 0 ? `${money(assignment.hourly_rate)}/hr` : "";
      return {
        date: dateOnly(call.call_date), call: text(call.description), production: productions.get(text(call.production_id)) || "",
        person: profiles.get(text(assignment.profile_id)) || text(assignment.crew_name) || "Open position",
        department: departments.get(text(assignment.department_id)) || "", job: text(assignment.job_title) || text(assignment.employment_type),
        sessions, rate, estimated: money(assignment.estimated_pay), actual: money(assignment.actual_pay),
      };
    });
    const title = variant === "daily-payroll"
      ? "GHSMTA Daily Payroll Report"
      : variant === "weekly-payroll"
        ? "GHSMTA Weekly Payroll Projection"
        : "GHSMTA Call Payroll Cost Report";
    return report(`call-${variant}`, title, columns, rows);
  }

  if (["department-schedule", "person-schedule"].includes(variant)) {
    const columns = [
      { key: "date", label: "Date" }, { key: "time", label: "Time" },
      { key: "production", label: "Production" }, { key: "call", label: "Call" },
      { key: "person", label: "Person / Position" }, { key: "department", label: "Department" },
      { key: "job", label: "Job" }, { key: "status", label: "Status" },
    ];
    const rows = assignments.map((assignment) => {
      const call = callMap.get(text(assignment.call_id)) ?? {};
      return {
        date: dateOnly(call.call_date), time: [timeOnly(call.start_time), timeOnly(call.end_time)].filter(Boolean).join(" - "),
        production: productions.get(text(call.production_id)) || "", call: text(call.description),
        person: profiles.get(text(assignment.profile_id)) || text(assignment.crew_name) || "Open position",
        department: departments.get(text(assignment.department_id)) || "", job: text(assignment.job_title), status: label(assignment.assignment_status),
      };
    });
    return report(
      variant === "person-schedule" ? "person-call-schedule" : "department-call-schedule",
      variant === "person-schedule" ? "GHSMTA Individual Call Schedule" : "GHSMTA Department Call Schedule",
      columns,
      rows,
    );
  }

  const assignmentsByCall = new Map<string, DataRow[]>();
  assignments.forEach((assignment) => {
    const callAssignments = assignmentsByCall.get(text(assignment.call_id)) ?? [];
    callAssignments.push(assignment);
    assignmentsByCall.set(text(assignment.call_id), callAssignments);
  });
  const callSheetAssignments = calls.flatMap((call) => {
    const callAssignments = assignmentsByCall.get(text(call.id));
    return callAssignments?.length ? callAssignments : [{ call_id: call.id }];
  });
  const columns = [
    { key: "date", label: "Date" }, { key: "call_time", label: "Call Time" },
    { key: "production", label: "Production" }, { key: "call", label: "Call" },
    { key: "person", label: "Person / Position" }, { key: "department", label: "Department" },
    { key: "job", label: "Job" }, { key: "time_1", label: "Time 1" },
    { key: "time_2", label: "Time 2" }, { key: "time_3", label: "Time 3" },
    { key: "location", label: "Location" }, { key: "status", label: "Status" },
    { key: "notes", label: "Notes" },
  ];
  const rows = callSheetAssignments.map((assignment) => {
    const call = callMap.get(text(assignment.call_id)) ?? {};
    const session = (start: unknown, end: unknown) => [timeOnly(start), timeOnly(end)].filter(Boolean).join(" - ");
    return {
      call_id: text(call.id), date: dateOnly(call.call_date),
      call_time: [timeOnly(call.start_time), timeOnly(call.end_time)].filter(Boolean).join(" - "),
      production: productions.get(text(call.production_id)) || "", call: text(call.description),
      person: profiles.get(text(assignment.profile_id)) || text(assignment.crew_name) || "Open position",
      department: departments.get(text(assignment.department_id)) || "Unassigned",
      job: text(assignment.job_title) || text(assignment.employment_type),
      time_1: session(assignment.time_1_start, assignment.time_1_end),
      time_2: session(assignment.time_2_start, assignment.time_2_end),
      time_3: session(assignment.time_3_start, assignment.time_3_end),
      location: locations.get(text(call.location_id)) || "",
      status: call.is_final ? "Final" : label(call.status),
      meals: [[call.meal_1_start, call.meal_1_end], [call.meal_2_start, call.meal_2_end]].filter(([start]) => Boolean(start)).map(([start, end]) => `${timeOnly(start)}-${timeOnly(end) || "?"}`).join(" / "),
      notes: text(assignment.notes) || text(call.notes),
    };
  });
  return report(
    variant === "daily-sign-in" ? "daily-call-sign-in" : "call-sheets",
    variant === "daily-sign-in" ? "GHSMTA Daily Sign-In Sheet" : "GHSMTA Production Call Sheets",
    columns,
    rows,
  );
}

async function loadBudgets(params: URLSearchParams): Promise<LoadedReport> {
  const supabase = await createClient();
  const variant = params.get("variant") || "budget";
  const productionId = params.get("production") || "";
  let lineQuery = supabase.from("ghsmta_operations_budget_lines").select("id,production_id,gl_code,department,original_budget,approved_changes,current_budget,notes").order("gl_code");
  let transactionQuery = supabase.from("ghsmta_operations_budget_transactions").select("production_id,budget_line_id,gl_code,department,amount,status,description,vendor_name,invoice_received,receipt_uploaded,document_link,transaction_date").order("transaction_date");
  if (productionId) { lineQuery = lineQuery.eq("production_id", productionId); transactionQuery = transactionQuery.eq("production_id", productionId); }
  const [linesResult, transactionsResult, productionsResult] = await Promise.all([
    lineQuery, transactionQuery, supabase.from("ghsmta_operations_productions").select("id,name"),
  ]);
  const error = linesResult.error || transactionsResult.error || productionsResult.error;
  if (error) throw new Error(error.message);
  const lines = (linesResult.data ?? []) as DataRow[];
  const transactions = (transactionsResult.data ?? []) as DataRow[];
  const productions = mapById((productionsResult.data ?? []) as DataRow[], "name");
  const productionName = productionId ? productions.get(productionId) || "Production" : "All Productions";

  if (variant === "detail") {
    const columns = [
      { key: "date", label: "Date" }, { key: "production", label: "Production" },
      { key: "gl", label: "GL Code" }, { key: "department", label: "Department" },
      { key: "description", label: "Description" }, { key: "vendor", label: "Vendor" },
      { key: "amount", label: "Amount" }, { key: "status", label: "Status" },
      { key: "invoice", label: "Invoice" }, { key: "receipt", label: "Receipt" },
    ];
    const rows = transactions.map((row) => ({
      date: dateOnly(row.transaction_date), production: productions.get(text(row.production_id)) || "", gl: text(row.gl_code),
      department: text(row.department), description: text(row.description), vendor: text(row.vendor_name), amount: money(row.amount),
      status: label(row.status), invoice: row.invoice_received ? "Yes" : "No", receipt: row.receipt_uploaded ? "Yes" : "No",
    }));
    return report("budget-detail", `GHSMTA Budget Detail - ${productionName}`, columns, rows);
  }

  const transactionTotals = new Map<string, number>();
  transactions.filter((row) => row.status !== "cancelled").forEach((row) => transactionTotals.set(text(row.budget_line_id), (transactionTotals.get(text(row.budget_line_id)) ?? 0) + Number(row.amount || 0)));
  const columns = [
    { key: "production", label: "Production" }, { key: "gl", label: "GL Code" },
    { key: "department", label: "Department" }, { key: "original", label: "Original Budget" },
    { key: "changes", label: "Approved Changes" }, { key: "current", label: "Current Budget" },
    { key: "forecast", label: "Forecast / Actual" }, { key: "remaining", label: "Remaining" },
    { key: "notes", label: "Notes" },
  ];
  const rows = lines.map((row) => {
    const forecast = transactionTotals.get(text(row.id)) ?? 0;
    return { production: productions.get(text(row.production_id)) || "", gl: text(row.gl_code), department: text(row.department), original: money(row.original_budget), changes: money(row.approved_changes), current: money(row.current_budget), forecast: money(forecast), remaining: money(Number(row.current_budget || 0) - forecast), notes: text(row.notes) };
  });
  return report("budget-forecast", `GHSMTA Budget Forecast - ${productionName}`, columns, rows);
}

async function loadTrucking(params: URLSearchParams): Promise<LoadedReport> {
  const supabase = await createClient();
  const variant = params.get("variant") || "schedule";
  const includeHidden = params.get("includeHidden") === "true";
  if (variant === "vehicles") {
    let query = supabase.from("ghsmta_operations_truck_vehicles").select("vehicle_name,vehicle_type,plate_number,current_location,door_type,capacity_notes,notes,active").order("sort_order").order("vehicle_name");
    if (!includeHidden) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const columns = [
      { key: "vehicle", label: "Vehicle / Trailer" }, { key: "type", label: "Type" },
      { key: "unit", label: "Plate / Unit" }, { key: "location", label: "Current Location" },
      { key: "door", label: "Door Type" }, { key: "capacity", label: "Capacity" },
      { key: "status", label: "Status" }, { key: "notes", label: "Notes" },
    ];
    const rows = ((data ?? []) as DataRow[]).map((row) => ({ vehicle: text(row.vehicle_name), type: text(row.vehicle_type), unit: text(row.plate_number), location: text(row.current_location), door: text(row.door_type), capacity: text(row.capacity_notes), status: row.active ? "Active" : "Inactive", notes: text(row.notes) }));
    return report("trailer-vehicle-report", includeHidden ? "GHSMTA Trailer and Vehicle Report - All" : "GHSMTA Trailer and Vehicle Report", columns, rows);
  }

  const productionId = params.get("production") || "";
  const date = params.get("date") || "";
  let moveQuery = supabase.from("ghsmta_operations_truck_moves").select("id,production_id,move_title,move_type,move_status,priority,scheduled_start,scheduled_end,truck_vehicle_id,driver_profile_id,driver_name,public_notes").order("scheduled_start", { nullsFirst: false });
  if (productionId) moveQuery = moveQuery.eq("production_id", productionId);
  const [movesResult, stopsResult, vehiclesResult, productionsResult, profilesResult] = await Promise.all([
    moveQuery,
    supabase.from("ghsmta_operations_truck_stops").select("truck_move_id,stop_order,stop_type,action_label,custom_location_name,custom_address,scheduled_arrival,scheduled_departure,trailer_label,is_complete,driver_profile_id,driver_name,truck_vehicle_id,stop_notes").order("stop_order"),
    supabase.from("ghsmta_operations_truck_vehicles").select("id,vehicle_name"),
    supabase.from("ghsmta_operations_productions").select("id,name"),
    supabase.from("profiles").select("id,full_name,email"),
  ]);
  const error = movesResult.error || stopsResult.error || vehiclesResult.error || productionsResult.error || profilesResult.error;
  if (error) throw new Error(error.message);
  const allMoves = (movesResult.data ?? []) as DataRow[];
  const moves = date ? allMoves.filter((row) => easternDateKey(row.scheduled_start) === date) : allMoves;
  const moveIds = new Set(moves.map((row) => text(row.id)));
  const stops = ((stopsResult.data ?? []) as DataRow[]).filter((row) => moveIds.has(text(row.truck_move_id)));
  const vehicles = mapById((vehiclesResult.data ?? []) as DataRow[], "vehicle_name");
  const productions = mapById((productionsResult.data ?? []) as DataRow[], "name");
  const profiles = new Map(((profilesResult.data ?? []) as DataRow[]).map((row) => [text(row.id), text(row.full_name) || text(row.email)]));
  const moveMap = new Map(moves.map((row) => [text(row.id), row]));
  const columns = [
    { key: "done", label: "Done" }, { key: "time", label: "Time" },
    { key: "move", label: "Move" }, { key: "production", label: "Production" },
    { key: "stop", label: "Stop / Action" }, { key: "location", label: "Location / Address" },
    { key: "vehicle", label: "Vehicle / Trailer" }, { key: "driver", label: "Driver" },
    { key: "status", label: "Status" }, { key: "notes", label: "Notes" },
  ];
  const rows = stops.length ? stops.map((stop) => {
    const move = moveMap.get(text(stop.truck_move_id)) ?? {};
    return {
      done: stop.is_complete ? "[x]" : "[ ]", time: [dateTime(stop.scheduled_arrival), dateTime(stop.scheduled_departure)].filter(Boolean).join(" - "),
      move: text(move.move_title), production: productions.get(text(move.production_id)) || "General GHSMTA",
      stop: `${text(stop.stop_order)}. ${text(stop.action_label) || label(stop.stop_type)}`, location: [text(stop.custom_location_name), text(stop.custom_address)].filter(Boolean).join(" - "),
      vehicle: vehicles.get(text(stop.truck_vehicle_id)) || vehicles.get(text(move.truck_vehicle_id)) || text(stop.trailer_label),
      driver: profiles.get(text(stop.driver_profile_id)) || text(stop.driver_name) || profiles.get(text(move.driver_profile_id)) || text(move.driver_name),
      status: label(move.move_status), notes: text(stop.stop_notes) || text(move.public_notes),
    };
  }) : moves.map((move) => ({ done: "[ ]", time: dateTime(move.scheduled_start), move: text(move.move_title), production: productions.get(text(move.production_id)) || "General GHSMTA", stop: label(move.move_type), location: "", vehicle: vehicles.get(text(move.truck_vehicle_id)) || "", driver: profiles.get(text(move.driver_profile_id)) || text(move.driver_name), status: label(move.move_status), notes: text(move.public_notes) }));
  return report("daily-trucking-schedule", "GHSMTA Daily Trucking Schedule", columns, rows);
}

export async function GET(request: Request) {
  await requireProfile(["owner"]);
  const url = new URL(request.url);
  const operationsModule = (url.searchParams.get("module") || "") as OperationsModule;
  const format = url.searchParams.get("format") === "csv" ? "csv" : "pdf";
  let loaded: LoadedReport;

  if (operationsModule === "productions") loaded = await loadProductions();
  else if (operationsModule === "schedule") loaded = await loadSchedule(url.searchParams);
  else if (operationsModule === "calls") loaded = await loadCalls(url.searchParams);
  else if (operationsModule === "budgets") loaded = await loadBudgets(url.searchParams);
  else if (operationsModule === "trucking") loaded = await loadTrucking(url.searchParams);
  else return NextResponse.json({ error: "Unknown Production Operations export." }, { status: 404 });

  loaded.filters.format = format;
  if (format === "csv") {
    const body = Buffer.from(buildReportCsv(loaded), "utf8");
    const filename = reportFilename(loaded, "csv");
    return new NextResponse(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(body.byteLength),
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  }

  const bytes = await buildOperationsProductionPdf(loaded);
  const body = Buffer.from(bytes);
  const filename = reportFilename(loaded, "pdf");
  return new NextResponse(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(body.byteLength),
      "Content-Type": "application/pdf",
    },
  });
}
