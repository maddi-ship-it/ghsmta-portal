#!/usr/bin/env node

/**
 * Creates or refreshes one fully populated LIVE test school/application using
 * the already-imported 2025-2026 Director form.
 *
 * Required .env.local values:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/import-dummy-school.mjs \
 *     --file data/peachtree-arts-academy-test-school.csv
 *
 * Optional:
 *   --email ghsmta.peachtree.test@example.com
 *   --password GHSMTA-Test-2026!
 *   --no-schedule
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filename) {
  if (!fs.existsSync(filename)) return;
  const contents = fs.readFileSync(filename, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function readSingleRowCsv(filename) {
  const text = fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, "");
  const rows = parseCsv(text).filter((row) =>
    row.some((value) => value.trim() !== ""),
  );
  if (rows.length !== 2) {
    throw new Error(
      `Expected exactly one dummy data row in ${filename}; found ${Math.max(rows.length - 1, 0)}.`,
    );
  }
  return { headers: rows[0], row: rows[1] };
}

function valueAt(headers, row, label, occurrence = 1) {
  let seen = 0;
  for (let index = 0; index < headers.length; index += 1) {
    if (headers[index] !== label) continue;
    seen += 1;
    if (seen === occurrence) return row[index] ?? "";
  }
  return "";
}

function normalizeAnswer(questionType, rawValue) {
  const value = rawValue.trim();
  if (!value) return null;

  if (questionType === "multi_select") {
    return value
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (questionType === "number") {
    const parsed = Number(value.replace(/[$,%]/g, "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : value;
  }

  if (
    questionType === "checkbox" ||
    questionType === "signature_acknowledgement"
  ) {
    return /^(yes|true|1|i agree|i acknowledge|signed)/i.test(value);
  }

  return value;
}

function rawPayload(headers, row) {
  const fields = {};
  headers.forEach((label, index) => {
    const value = row[index] ?? "";
    if (!value.trim()) return;
    fields[`c${String(index).padStart(3, "0")}`] = { label, value };
  });
  return { fields };
}

function throwIfError(result, context) {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
  return result.data;
}

async function findOrCreateAuthUser(supabase, email, password, fullName) {
  const normalizedEmail = email.trim().toLowerCase();
  let user = null;

  for (let page = 1; page <= 10 && !user; page += 1) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error(`List users: ${result.error.message}`);
    user = result.data.users.find(
      (candidate) => candidate.email?.toLowerCase() === normalizedEmail,
    );
    if (result.data.users.length < 1000) break;
  }

  if (!user) {
    const created = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (created.error || !created.data.user) {
      throw new Error(
        `Create test applicant: ${created.error?.message ?? "Unknown error"}`,
      );
    }
    user = created.data.user;
  } else {
    const updated = await supabase.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (updated.error) {
      throw new Error(`Refresh test applicant: ${updated.error.message}`);
    }
    user = updated.data.user;
  }

  throwIfError(
    await supabase.from("profiles").upsert({
      id: user.id,
      email: normalizedEmail,
      full_name: fullName,
      role: "applicant",
      active: true,
    }),
    "Upsert applicant profile",
  );

  return user;
}

async function findDirectorCycle(supabase) {
  let result = await supabase
    .from("award_cycles")
    .select("*")
    .eq("cycle_key", "2025-2026-directors")
    .maybeSingle();
  throwIfError(result, "Find 2025-2026 Director cycle");

  if (result.data) return result.data;

  result = await supabase
    .from("award_cycles")
    .select("*")
    .eq("season_year", "2025-2026")
    .eq("program_type", "directors")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  throwIfError(result, "Find fallback 2025-2026 Director cycle");

  if (!result.data) {
    throw new Error(
      "The 2025-2026 Director cycle is missing. Run the full Acceptd archive importer first.",
    );
  }

  return result.data;
}

async function findImportedForm(supabase, cycleId) {
  let result = await supabase
    .from("application_form_versions")
    .select("*")
    .eq("cycle_id", cycleId)
    .eq("source_system", "acceptd")
    .ilike("name", "%Full Acceptd Import%")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(result, "Find full imported Director form");

  if (!result.data) {
    result = await supabase
      .from("application_form_versions")
      .select("*")
      .eq("cycle_id", cycleId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(result, "Find fallback Director form");
  }

  if (!result.data) {
    throw new Error(
      "No Director application form exists for the 2025-2026 cycle.",
    );
  }

  return result.data;
}

async function ensureSchool(supabase) {
  const schoolCode = "TEST-PAA-001";
  const existing = await supabase
    .from("schools")
    .select("id")
    .eq("school_code", schoolCode)
    .maybeSingle();
  throwIfError(existing, "Find test school");

  const payload = {
    name: "Peachtree Arts Academy (TEST)",
    city: "Brookhaven",
    county: "DeKalb",
    school_code: schoolCode,
    active: true,
  };

  if (existing.data) {
    return throwIfError(
      await supabase
        .from("schools")
        .update(payload)
        .eq("id", existing.data.id)
        .select("id")
        .single(),
      "Update test school",
    );
  }

  return throwIfError(
    await supabase.from("schools").insert(payload).select("id").single(),
    "Create test school",
  );
}

async function ensureApplication({
  supabase,
  cycle,
  form,
  user,
  school,
  headers,
  row,
  stages,
}) {
  const sourceSystem = "dummy-seed";
  const sourceRecordId = valueAt(headers, row, "App Id") || "TEST-PAA-2025-2026-001";
  const lastVisibleStage = [...stages]
    .filter((stage) => stage.applicant_visible)
    .sort((a, b) => b.sort_order - a.sort_order)[0];

  const payload = {
    cycle_id: cycle.id,
    form_version_id: form.id,
    applicant_user_id: user.id,
    school_id: school.id,
    school_name: valueAt(headers, row, "School Name"),
    production_title: valueAt(headers, row, "Name of Musical Production"),
    status: "submitted",
    submitted_at: new Date().toISOString(),
    form_data: {
      dummy_seed: true,
      test_school_code: "TEST-PAA-001",
      test_login_email: user.email,
      source_note: "Fictional GHSMTA portal test data. Safe to delete.",
    },
    current_stage_id: lastVisibleStage?.id ?? null,
    external_applicant_name: `${valueAt(headers, row, "First Name")} ${valueAt(headers, row, "Last Name")}`.trim(),
    external_applicant_email: user.email,
    source_system: sourceSystem,
    source_record_id: sourceRecordId,
    source_stage: valueAt(headers, row, "Stage") || "Section D | Post-Nominations",
    is_archived: false,
    archived_payload: rawPayload(headers, row),
  };

  const bySource = await supabase
    .from("applications")
    .select("id")
    .eq("source_system", sourceSystem)
    .eq("source_record_id", sourceRecordId)
    .maybeSingle();
  throwIfError(bySource, "Find dummy application by source ID");

  if (bySource.data) {
    return throwIfError(
      await supabase
        .from("applications")
        .update(payload)
        .eq("id", bySource.data.id)
        .select("id")
        .single(),
      "Refresh dummy application",
    );
  }

  const byApplicant = await supabase
    .from("applications")
    .select("id")
    .eq("cycle_id", cycle.id)
    .eq("applicant_user_id", user.id)
    .eq("is_archived", false)
    .maybeSingle();
  throwIfError(byApplicant, "Find dummy applicant's existing application");

  if (byApplicant.data) {
    return throwIfError(
      await supabase
        .from("applications")
        .update(payload)
        .eq("id", byApplicant.data.id)
        .select("id")
        .single(),
      "Convert existing test application",
    );
  }

  return throwIfError(
    await supabase.from("applications").insert(payload).select("id").single(),
    "Create dummy application",
  );
}

async function importAnswers({ supabase, formId, applicationId, row }) {
  const questionsResult = await supabase
    .from("application_questions")
    .select("id,question_type,source_column_index")
    .eq("form_version_id", formId)
    .eq("active", true)
    .not("source_column_index", "is", null)
    .order("source_column_index");
  const questions = throwIfError(questionsResult, "Read imported questions");

  const answers = questions
    .map((question) => {
      const rawValue = row[question.source_column_index] ?? "";
      const value = normalizeAnswer(question.question_type, rawValue);
      if (value == null || question.question_type === "content") return null;
      return {
        application_id: applicationId,
        question_id: question.id,
        value,
        updated_by: null,
      };
    })
    .filter(Boolean);

  for (let index = 0; index < answers.length; index += 400) {
    throwIfError(
      await supabase
        .from("application_answers")
        .upsert(answers.slice(index, index + 400), {
          onConflict: "application_id,question_id",
        }),
      `Upsert answer batch ${index / 400 + 1}`,
    );
  }

  return answers.length;
}

async function completeStages(supabase, applicationId, stages) {
  const completedAt = new Date().toISOString();
  const rows = stages.map((stage) => ({
    application_id: applicationId,
    stage_id: stage.id,
    status: "complete",
    started_at: completedAt,
    submitted_at: completedAt,
    completed_at: completedAt,
  }));

  throwIfError(
    await supabase
      .from("application_stage_progress")
      .upsert(rows, { onConflict: "application_id,stage_id" }),
    "Complete dummy application stages",
  );
}

async function ensureSchedule(supabase, cycleId, applicationId, applicantUserId) {
  const title = "TEST — Peachtree Arts Academy Adjudication";

  const existing = await supabase
    .from("schedule_slots")
    .select("id")
    .eq("cycle_id", cycleId)
    .eq("title", title)
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    if (existing.error.code === "42P01") {
      console.warn("Scheduling tables are not installed; skipping the test slot.");
      return null;
    }
    throw new Error(`Find test schedule slot: ${existing.error.message}`);
  }

  const slotPayload = {
    cycle_id: cycleId,
    title,
    starts_at: "2026-11-14T19:00:00-05:00",
    ends_at: "2026-11-14T21:30:00-05:00",
    location: "Peachtree Arts Academy — TEST Auditorium",
    school_instructions:
      "TEST DATA: Arrive through the performing arts entrance. Reserved parking is marked with purple signs.",
    status: "open",
  };

  let slot;
  if (existing.data) {
    slot = throwIfError(
      await supabase
        .from("schedule_slots")
        .update(slotPayload)
        .eq("id", existing.data.id)
        .select("id")
        .single(),
      "Refresh test schedule slot",
    );
  } else {
    slot = throwIfError(
      await supabase.from("schedule_slots").insert(slotPayload).select("id").single(),
      "Create test schedule slot",
    );
  }

  const booking = await supabase
    .from("schedule_school_bookings")
    .select("id")
    .eq("application_id", applicationId)
    .maybeSingle();
  throwIfError(booking, "Find test school booking");

  if (booking.data) {
    throwIfError(
      await supabase
        .from("schedule_school_bookings")
        .update({ slot_id: slot.id, booked_by: applicantUserId })
        .eq("id", booking.data.id),
      "Refresh test school booking",
    );
  } else {
    throwIfError(
      await supabase.from("schedule_school_bookings").insert({
        slot_id: slot.id,
        application_id: applicationId,
        booked_by: applicantUserId,
      }),
      "Create test school booking",
    );
  }

  return slot.id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = path.resolve(
    args.file ?? "data/peachtree-arts-academy-test-school.csv",
  );
  const email = String(
    args.email ?? "ghsmta.peachtree.test@example.com",
  ).toLowerCase();
  const password = String(args.password ?? "GHSMTA-Test-2026!");
  const withSchedule = !args["no-schedule"];

  if (!fs.existsSync(file)) {
    throw new Error(`Dummy data file not found: ${file}`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env.local.",
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { headers, row } = readSingleRowCsv(file);
  const fullName = `${valueAt(headers, row, "First Name")} ${valueAt(headers, row, "Last Name")}`.trim();

  console.log("Creating or refreshing the dummy applicant account…");
  const user = await findOrCreateAuthUser(
    supabase,
    email,
    password,
    fullName || "Jordan Ellis",
  );

  console.log("Locating the 2025-2026 Director application form…");
  const cycle = await findDirectorCycle(supabase);
  const form = await findImportedForm(supabase, cycle.id);

  const stagesResult = await supabase
    .from("application_stages")
    .select("id,title,sort_order,applicant_visible")
    .eq("form_version_id", form.id)
    .order("sort_order");
  const stages = throwIfError(stagesResult, "Read Director application stages");
  if (stages.length === 0) {
    throw new Error("The imported Director form has no application stages.");
  }

  console.log("Creating or refreshing the test school and submitted application…");
  const school = await ensureSchool(supabase);
  const application = await ensureApplication({
    supabase,
    cycle,
    form,
    user,
    school,
    headers,
    row,
    stages,
  });

  const answerCount = await importAnswers({
    supabase,
    formId: form.id,
    applicationId: application.id,
    row,
  });
  await completeStages(supabase, application.id, stages);

  let scheduleSlotId = null;
  if (withSchedule) {
    console.log("Creating a confirmed TEST adjudication slot…");
    scheduleSlotId = await ensureSchedule(
      supabase,
      cycle.id,
      application.id,
      user.id,
    );
  }

  console.log("\nDummy school import complete.\n");
  console.log(`School: Peachtree Arts Academy (TEST)`);
  console.log(`Production: Moonlight Over Georgia (TEST MUSICAL)`);
  console.log(`Applicant login: ${email}`);
  console.log(`Applicant password: ${password}`);
  console.log(`Application ID: ${application.id}`);
  console.log(`Imported answers: ${answerCount}`);
  console.log(`Schedule slot: ${scheduleSlotId ?? "not created"}`);
  console.log("\nAssign adjudicators from Scoring Setup or add them to the TEST schedule slot.");
}

main().catch((error) => {
  console.error("\nDummy school import failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
