"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const OPERATIONS_ROOT = "/portal/admin/operations";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullable(formData: FormData, key: string) {
  return value(formData, key) || null;
}

function numberValue(formData: FormData, key: string) {
  const raw = value(formData, key);
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a valid number.`);
  return parsed;
}

function checkbox(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function requireValue(formData: FormData, key: string, label: string) {
  const result = value(formData, key);
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function revalidateOperations(extraPath?: string) {
  revalidatePath(OPERATIONS_ROOT);
  revalidatePath(`${OPERATIONS_ROOT}/schedule`);
  revalidatePath(`${OPERATIONS_ROOT}/calls`);
  revalidatePath(`${OPERATIONS_ROOT}/budgets`);
  if (extraPath) revalidatePath(extraPath);
}

async function ownerContext() {
  const profile = await requireProfile(["owner"]);
  const supabase = await createClient();
  return { profile, supabase };
}

export async function createOperationsProduction(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const { error } = await supabase.from("ghsmta_operations_productions").insert({
    cycle_id: nullable(formData, "cycle_id"),
    name: requireValue(formData, "name", "Production name"),
    code: nullable(formData, "code"),
    status: value(formData, "status") || "planning",
    director: nullable(formData, "director"),
    venue: nullable(formData, "venue"),
    first_rehearsal_date: nullable(formData, "first_rehearsal_date"),
    load_in_date: nullable(formData, "load_in_date"),
    opening_date: nullable(formData, "opening_date"),
    closing_date: nullable(formData, "closing_date"),
    notes: nullable(formData, "notes"),
    created_by: profile.id,
    updated_by: profile.id,
  });
  if (error) throw new Error(error.message);
  revalidateOperations();
}

export async function updateOperationsProduction(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const id = requireValue(formData, "production_id", "Production");
  const { error } = await supabase
    .from("ghsmta_operations_productions")
    .update({
      cycle_id: nullable(formData, "cycle_id"),
      name: requireValue(formData, "name", "Production name"),
      code: nullable(formData, "code"),
      status: value(formData, "status") || "planning",
      director: nullable(formData, "director"),
      venue: nullable(formData, "venue"),
      first_rehearsal_date: nullable(formData, "first_rehearsal_date"),
      load_in_date: nullable(formData, "load_in_date"),
      opening_date: nullable(formData, "opening_date"),
      closing_date: nullable(formData, "closing_date"),
      notes: nullable(formData, "notes"),
      updated_by: profile.id,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateOperations();
}

export async function deleteOperationsProduction(formData: FormData) {
  const { supabase } = await ownerContext();
  const id = requireValue(formData, "production_id", "Production");
  const { error } = await supabase
    .from("ghsmta_operations_productions")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateOperations();
}

export async function createOperationsDepartment(formData: FormData) {
  const { supabase } = await ownerContext();
  const { error } = await supabase.from("ghsmta_operations_departments").insert({
    name: requireValue(formData, "name", "Department name"),
    sort_order: numberValue(formData, "sort_order"),
  });
  if (error) throw new Error(error.message);
  revalidateOperations();
}

export async function createOperationsLocation(formData: FormData) {
  const { supabase } = await ownerContext();
  const { error } = await supabase.from("ghsmta_operations_locations").insert({
    name: requireValue(formData, "name", "Location name"),
    location_type: nullable(formData, "location_type"),
    address: nullable(formData, "address"),
    notes: nullable(formData, "notes"),
  });
  if (error) throw new Error(error.message);
  revalidateOperations();
}

export async function createScheduleEvent(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const { error } = await supabase.from("ghsmta_operations_schedule_events").insert({
    production_id: nullable(formData, "production_id"),
    department_id: nullable(formData, "department_id"),
    location_id: nullable(formData, "location_id"),
    title: requireValue(formData, "title", "Event title"),
    event_type: value(formData, "event_type") || "general",
    status: value(formData, "status") || "scheduled",
    event_date: requireValue(formData, "event_date", "Event date"),
    start_time: nullable(formData, "start_time"),
    end_time: nullable(formData, "end_time"),
    all_day: checkbox(formData, "all_day"),
    visibility: value(formData, "visibility") || "owners",
    is_deadline: checkbox(formData, "is_deadline"),
    is_announcement: checkbox(formData, "is_announcement"),
    description: nullable(formData, "description"),
    notes: nullable(formData, "notes"),
    created_by: profile.id,
    updated_by: profile.id,
  });
  if (error) throw new Error(error.message);
  revalidateOperations();
}

export async function updateScheduleEvent(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const id = requireValue(formData, "event_id", "Event");
  const { error } = await supabase
    .from("ghsmta_operations_schedule_events")
    .update({
      production_id: nullable(formData, "production_id"),
      department_id: nullable(formData, "department_id"),
      location_id: nullable(formData, "location_id"),
      title: requireValue(formData, "title", "Event title"),
      event_type: value(formData, "event_type") || "general",
      status: value(formData, "status") || "scheduled",
      event_date: requireValue(formData, "event_date", "Event date"),
      start_time: nullable(formData, "start_time"),
      end_time: nullable(formData, "end_time"),
      all_day: checkbox(formData, "all_day"),
      visibility: value(formData, "visibility") || "owners",
      is_deadline: checkbox(formData, "is_deadline"),
      is_announcement: checkbox(formData, "is_announcement"),
      description: nullable(formData, "description"),
      notes: nullable(formData, "notes"),
      updated_by: profile.id,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateOperations();
}

export async function duplicateScheduleEvent(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const id = requireValue(formData, "event_id", "Event");
  const { data, error: loadError } = await supabase
    .from("ghsmta_operations_schedule_events")
    .select("production_id,department_id,location_id,title,event_type,status,event_date,start_time,end_time,all_day,visibility,is_deadline,is_announcement,description,notes")
    .eq("id", id)
    .single();
  if (loadError || !data) throw new Error(loadError?.message || "Event not found.");
  const { error } = await supabase.from("ghsmta_operations_schedule_events").insert({
    ...data,
    title: `${data.title} (copy)`,
    status: "draft",
    created_by: profile.id,
    updated_by: profile.id,
  });
  if (error) throw new Error(error.message);
  revalidateOperations();
}

export async function deleteScheduleEvent(formData: FormData) {
  const { supabase } = await ownerContext();
  const id = requireValue(formData, "event_id", "Event");
  const { error } = await supabase
    .from("ghsmta_operations_schedule_events")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateOperations();
}

export async function createCall(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const payload = {
    production_id: requireValue(formData, "production_id", "Production"),
    schedule_event_id: nullable(formData, "schedule_event_id"),
    location_id: nullable(formData, "location_id"),
    call_date: requireValue(formData, "call_date", "Call date"),
    start_time: nullable(formData, "start_time"),
    end_time: nullable(formData, "end_time"),
    meal_1_start: nullable(formData, "meal_1_start"),
    meal_1_end: nullable(formData, "meal_1_end"),
    meal_2_start: nullable(formData, "meal_2_start"),
    meal_2_end: nullable(formData, "meal_2_end"),
    call_type: value(formData, "call_type") || "general",
    status: value(formData, "status") || "draft",
    description: requireValue(formData, "description", "Call description"),
    notes: nullable(formData, "notes"),
    original_budget: numberValue(formData, "original_budget"),
    is_final: checkbox(formData, "is_final"),
    created_by: profile.id,
    updated_by: profile.id,
  };
  const { error } = await supabase.from("ghsmta_operations_calls").insert(payload);
  if (error) throw new Error(error.message);
  revalidateOperations();
}

export async function updateCall(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const id = requireValue(formData, "call_id", "Call");
  const { error } = await supabase
    .from("ghsmta_operations_calls")
    .update({
      production_id: requireValue(formData, "production_id", "Production"),
      schedule_event_id: nullable(formData, "schedule_event_id"),
      location_id: nullable(formData, "location_id"),
      call_date: requireValue(formData, "call_date", "Call date"),
      start_time: nullable(formData, "start_time"),
      end_time: nullable(formData, "end_time"),
      meal_1_start: nullable(formData, "meal_1_start"),
      meal_1_end: nullable(formData, "meal_1_end"),
      meal_2_start: nullable(formData, "meal_2_start"),
      meal_2_end: nullable(formData, "meal_2_end"),
      call_type: value(formData, "call_type") || "general",
      status: value(formData, "status") || "draft",
      description: requireValue(formData, "description", "Call description"),
      notes: nullable(formData, "notes"),
      original_budget: numberValue(formData, "original_budget"),
      is_final: checkbox(formData, "is_final"),
      updated_by: profile.id,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateOperations(`${OPERATIONS_ROOT}/calls/${id}`);
}

export async function duplicateCall(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const id = requireValue(formData, "call_id", "Call");
  const [{ data: call, error: callError }, { data: assignments, error: assignmentError }] =
    await Promise.all([
      supabase
        .from("ghsmta_operations_calls")
        .select("production_id,location_id,call_date,start_time,end_time,meal_1_start,meal_1_end,meal_2_start,meal_2_end,call_type,description,notes,original_budget")
        .eq("id", id)
        .single(),
      supabase
        .from("ghsmta_operations_call_assignments")
        .select("profile_id,department_id,crew_name,job_title,employment_type,time_1_start,time_1_end,time_2_start,time_2_end,time_3_start,time_3_end,hourly_rate,flat_rate,estimated_hours,notes")
        .eq("call_id", id),
    ]);
  if (callError || !call) throw new Error(callError?.message || "Call not found.");
  if (assignmentError) throw new Error(assignmentError.message);
  const { data: copy, error } = await supabase
    .from("ghsmta_operations_calls")
    .insert({
      ...call,
      description: `${call.description} (copy)`,
      status: "draft",
      is_final: false,
      created_by: profile.id,
      updated_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !copy) throw new Error(error?.message || "Unable to duplicate call.");
  if (assignments?.length) {
    const { error: copyError } = await supabase
      .from("ghsmta_operations_call_assignments")
      .insert(
        assignments.map((assignment) => ({
          ...assignment,
          call_id: copy.id,
          assignment_status: "scheduled",
          created_by: profile.id,
          updated_by: profile.id,
        })),
      );
    if (copyError) throw new Error(copyError.message);
  }
  revalidateOperations();
}

export async function deleteCall(formData: FormData) {
  const { supabase } = await ownerContext();
  const id = requireValue(formData, "call_id", "Call");
  const { error } = await supabase
    .from("ghsmta_operations_calls")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateOperations();
}

export async function addCallAssignment(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const callId = requireValue(formData, "call_id", "Call");
  const profileId = nullable(formData, "profile_id");
  const crewName = nullable(formData, "crew_name");
  if (!profileId && !crewName) throw new Error("Choose a portal user or enter a crew name.");
  const estimatedHours = numberValue(formData, "estimated_hours");
  const hourlyRate = numberValue(formData, "hourly_rate");
  const flatRate = numberValue(formData, "flat_rate");
  const { error } = await supabase.from("ghsmta_operations_call_assignments").insert({
    call_id: callId,
    profile_id: profileId,
    department_id: nullable(formData, "department_id"),
    crew_name: crewName,
    job_title: nullable(formData, "job_title"),
    employment_type: nullable(formData, "employment_type"),
    assignment_status: value(formData, "assignment_status") || "scheduled",
    time_1_start: nullable(formData, "time_1_start"),
    time_1_end: nullable(formData, "time_1_end"),
    time_2_start: nullable(formData, "time_2_start"),
    time_2_end: nullable(formData, "time_2_end"),
    time_3_start: nullable(formData, "time_3_start"),
    time_3_end: nullable(formData, "time_3_end"),
    hourly_rate: hourlyRate || null,
    flat_rate: flatRate || null,
    estimated_hours: estimatedHours || null,
    estimated_pay: flatRate || estimatedHours * hourlyRate || null,
    notes: nullable(formData, "notes"),
    created_by: profile.id,
    updated_by: profile.id,
  });
  if (error) throw new Error(error.message);
  revalidateOperations(`${OPERATIONS_ROOT}/calls/${callId}`);
}

export async function updateCallAssignment(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const assignmentId = requireValue(formData, "assignment_id", "Assignment");
  const callId = requireValue(formData, "call_id", "Call");
  const actualHours = numberValue(formData, "actual_hours");
  const actualPay = numberValue(formData, "actual_pay");
  const { error } = await supabase
    .from("ghsmta_operations_call_assignments")
    .update({
      assignment_status: value(formData, "assignment_status") || "scheduled",
      actual_hours: actualHours || null,
      actual_pay: actualPay || null,
      notes: nullable(formData, "notes"),
      updated_by: profile.id,
    })
    .eq("id", assignmentId);
  if (error) throw new Error(error.message);
  revalidateOperations(`${OPERATIONS_ROOT}/calls/${callId}`);
}

export async function deleteCallAssignment(formData: FormData) {
  const { supabase } = await ownerContext();
  const assignmentId = requireValue(formData, "assignment_id", "Assignment");
  const callId = requireValue(formData, "call_id", "Call");
  const { error } = await supabase
    .from("ghsmta_operations_call_assignments")
    .delete()
    .eq("id", assignmentId);
  if (error) throw new Error(error.message);
  revalidateOperations(`${OPERATIONS_ROOT}/calls/${callId}`);
}

export async function createBudgetLine(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const productionId = requireValue(formData, "production_id", "Production");
  const { error } = await supabase.from("ghsmta_operations_budget_lines").insert({
    production_id: productionId,
    gl_code: requireValue(formData, "gl_code", "GL code"),
    department: nullable(formData, "department"),
    original_budget: numberValue(formData, "original_budget"),
    approved_changes: numberValue(formData, "approved_changes"),
    notes: nullable(formData, "notes"),
    created_by: profile.id,
    updated_by: profile.id,
  });
  if (error) throw new Error(error.message);
  revalidateOperations(`${OPERATIONS_ROOT}/budgets/${productionId}`);
}

export async function updateBudgetLine(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const productionId = requireValue(formData, "production_id", "Production");
  const lineId = requireValue(formData, "line_id", "Budget line");
  const { error } = await supabase
    .from("ghsmta_operations_budget_lines")
    .update({
      gl_code: requireValue(formData, "gl_code", "GL code"),
      department: nullable(formData, "department"),
      original_budget: numberValue(formData, "original_budget"),
      approved_changes: numberValue(formData, "approved_changes"),
      notes: nullable(formData, "notes"),
      updated_by: profile.id,
    })
    .eq("id", lineId);
  if (error) throw new Error(error.message);
  revalidateOperations(`${OPERATIONS_ROOT}/budgets/${productionId}`);
}

export async function deleteBudgetLine(formData: FormData) {
  const { supabase } = await ownerContext();
  const productionId = requireValue(formData, "production_id", "Production");
  const lineId = requireValue(formData, "line_id", "Budget line");
  const { error } = await supabase
    .from("ghsmta_operations_budget_lines")
    .delete()
    .eq("id", lineId);
  if (error) throw new Error(error.message);
  revalidateOperations(`${OPERATIONS_ROOT}/budgets/${productionId}`);
}

export async function createBudgetTransaction(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const productionId = requireValue(formData, "production_id", "Production");
  const { error } = await supabase
    .from("ghsmta_operations_budget_transactions")
    .insert({
      production_id: productionId,
      budget_line_id: nullable(formData, "budget_line_id"),
      gl_code: requireValue(formData, "gl_code", "GL code"),
      department: nullable(formData, "department"),
      amount: numberValue(formData, "amount"),
      status: value(formData, "status") || "requested",
      description: requireValue(formData, "description", "Description"),
      vendor_name: nullable(formData, "vendor_name"),
      invoice_received: checkbox(formData, "invoice_received"),
      receipt_uploaded: checkbox(formData, "receipt_uploaded"),
      document_link: nullable(formData, "document_link"),
      transaction_date: value(formData, "transaction_date") || new Date().toISOString().slice(0, 10),
      created_by: profile.id,
      updated_by: profile.id,
    });
  if (error) throw new Error(error.message);
  revalidateOperations(`${OPERATIONS_ROOT}/budgets/${productionId}`);
}

export async function updateBudgetTransaction(formData: FormData) {
  const { profile, supabase } = await ownerContext();
  const productionId = requireValue(formData, "production_id", "Production");
  const transactionId = requireValue(formData, "transaction_id", "Transaction");
  const { error } = await supabase
    .from("ghsmta_operations_budget_transactions")
    .update({
      status: value(formData, "status") || "requested",
      invoice_received: checkbox(formData, "invoice_received"),
      receipt_uploaded: checkbox(formData, "receipt_uploaded"),
      document_link: nullable(formData, "document_link"),
      updated_by: profile.id,
    })
    .eq("id", transactionId);
  if (error) throw new Error(error.message);
  revalidateOperations(`${OPERATIONS_ROOT}/budgets/${productionId}`);
}

export async function deleteBudgetTransaction(formData: FormData) {
  const { supabase } = await ownerContext();
  const productionId = requireValue(formData, "production_id", "Production");
  const transactionId = requireValue(formData, "transaction_id", "Transaction");
  const { error } = await supabase
    .from("ghsmta_operations_budget_transactions")
    .delete()
    .eq("id", transactionId);
  if (error) throw new Error(error.message);
  revalidateOperations(`${OPERATIONS_ROOT}/budgets/${productionId}`);
}
