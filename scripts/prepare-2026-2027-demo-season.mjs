#!/usr/bin/env node

/**
 * GHSMTA 2026-2027 season rollover + demo-school seed.
 *
 * This script is intentionally data-safe:
 * - Existing records are archived/closed, never deleted.
 * - The new Director program clones the latest existing Director form/rubric.
 * - Ten confirmed demo applicant accounts are created through Supabase Admin.
 * - Demo applications are fully submitted and populated from the imported
 *   Acceptd-shaped template CSV.
 * - Twelve open schedule slots are created with realtime-ready availability.
 *
 * Required in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Preview:
 *   node scripts/prepare-2026-2027-demo-season.mjs
 *
 * Apply:
 *   node scripts/prepare-2026-2027-demo-season.mjs --apply
 *
 * Optional:
 *   --password 'Different-Demo-Password!'
 *   --source-cycle-key 2025-2026-directors
 *   --no-schedule
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const TARGET_SEASON = "2026-2027";
const TARGET_CYCLE_KEY = "2026-2027-directors";
const TARGET_CYCLE_NAME = "2026–2027 Director Application";
const TARGET_FORM_NAME = "2026–2027 Director Application Form";
const TARGET_RUBRIC_NAME = "2026–2027 Director Scoring Rubric";
const DEMO_SOURCE_SYSTEM = "ghsmta-demo-2026-2027";
const DEFAULT_PASSWORD = "GHSMTA-Demo-2027!";
const ARCHIVE_REASON =
  "Archived during the 2026–2027 season rollover and demo-environment setup.";

const DEMO_SCHOOLS = [
  {
    "index": 1,
    "school": "Peachtree Arts Academy (DEMO)",
    "production": "Moonlight Over Georgia",
    "first": "Jordan",
    "last": "Ellis",
    "city": "Brookhaven",
    "county": "DeKalb",
    "street": "101 Demo Arts Way",
    "zip": "30319"
  },
  {
    "index": 2,
    "school": "Magnolia Ridge High School (DEMO)",
    "production": "Bright Star",
    "first": "Taylor",
    "last": "Morgan",
    "city": "Marietta",
    "county": "Cobb",
    "street": "202 Magnolia Stage Road",
    "zip": "30060"
  },
  {
    "index": 3,
    "school": "North Fulton Performing Arts High (DEMO)",
    "production": "The Drowsy Chaperone",
    "first": "Avery",
    "last": "Brooks",
    "city": "Roswell",
    "county": "Fulton",
    "street": "303 Spotlight Lane",
    "zip": "30075"
  },
  {
    "index": 4,
    "school": "Lakeview Fine Arts Academy (DEMO)",
    "production": "Once on This Island",
    "first": "Cameron",
    "last": "Reed",
    "city": "Gainesville",
    "county": "Hall",
    "street": "404 Lakeview Theatre Drive",
    "zip": "30501"
  },
  {
    "index": 5,
    "school": "Red Clay High School (DEMO)",
    "production": "Newsies",
    "first": "Morgan",
    "last": "Hayes",
    "city": "Cartersville",
    "county": "Bartow",
    "street": "505 Red Clay Avenue",
    "zip": "30120"
  },
  {
    "index": 6,
    "school": "Blue Ridge Performing Arts Academy (DEMO)",
    "production": "Into the Woods",
    "first": "Riley",
    "last": "Parker",
    "city": "Blue Ridge",
    "county": "Fannin",
    "street": "606 Mountain Curtain Road",
    "zip": "30513"
  },
  {
    "index": 7,
    "school": "South Metro Arts High School (DEMO)",
    "production": "Sister Act",
    "first": "Casey",
    "last": "Bennett",
    "city": "McDonough",
    "county": "Henry",
    "street": "707 South Metro Boulevard",
    "zip": "30253"
  },
  {
    "index": 8,
    "school": "Georgia Coastal Arts School (DEMO)",
    "production": "The Addams Family",
    "first": "Jamie",
    "last": "Collins",
    "city": "Savannah",
    "county": "Chatham",
    "street": "808 Coastal Stage Street",
    "zip": "31401"
  },
  {
    "index": 9,
    "school": "Pinecrest High School (DEMO)",
    "production": "Something Rotten!",
    "first": "Drew",
    "last": "Sullivan",
    "city": "Douglasville",
    "county": "Douglas",
    "street": "909 Pinecrest Playhouse Way",
    "zip": "30134"
  },
  {
    "index": 10,
    "school": "Chattahoochee Valley Academy (DEMO)",
    "production": "Little Shop of Horrors",
    "first": "Alex",
    "last": "Ramirez",
    "city": "Columbus",
    "county": "Muscogee",
    "street": "1010 Riverfront Theatre Road",
    "zip": "31901"
  }
];

function loadEnvFile(filename) {
  if (!fs.existsSync(filename)) return;

  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
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

function throwIfError(result, context) {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
  return result.data;
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
      `Expected one template row in ${filename}; found ${Math.max(rows.length - 1, 0)}.`,
    );
  }

  return {
    headers: rows[0],
    row: rows[1],
  };
}

function replaceAllByLabel(headers, row, label, value) {
  let replaced = 0;

  headers.forEach((header, index) => {
    if (header === label) {
      row[index] = value;
      replaced += 1;
    }
  });

  return replaced;
}

function customizeTemplateRow(headers, templateRow, school) {
  const row = [...templateRow];
  const email = `ghsmta.demo${String(school.index).padStart(2, "0")}@example.com`;
  const phone = `(404) 555-${String(1200 + school.index).padStart(4, "0")}`;
  const schoolCode = `DEMO-2627-${String(school.index).padStart(2, "0")}`;

  const replacements = [
    ["App Id", `DEMO-2627-${String(school.index).padStart(3, "0")}`],
    ["First Name", school.first],
    ["Last Name", school.last],
    ["School Name", school.school],
    ["Name of Musical Production", school.production],
    ["Email Address", email],
    ["Cell Phone Number", phone],
    ["School Phone Number & Extension", phone],
    ["School Address - Street Address", school.street],
    ["School Address - Street Address 2", ""],
    ["School Address - City", school.city],
    ["School Address - State", "Georgia"],
    ["School Address - ZIP/Postal Code", school.zip],
    ["School Address - Country", "United States"],
    ["School COUNTY (not Country)", school.county],
    ["Theatre Department Website or Page", `https://example.com/${schoolCode.toLowerCase()}`],
    ["Parent Liaison/On-Site Contact Email", email],
    ["Performance Location/Venue Address - Street Address", school.street],
    ["Performance Location/Venue Address - Street Address 2", "Performing Arts Entrance"],
    ["Performance Location/Venue Address - City", school.city],
    ["Performance Location/Venue Address - State", "Georgia"],
    ["Performance Location/Venue Address - ZIP/Postal Code", school.zip],
    ["Performance Location/Venue Address - Country", "United States"],
    ["Venue Phone", phone],
    ["Venue Website", `https://example.com/${schoolCode.toLowerCase()}/venue`],
  ];

  replacements.forEach(([label, value]) => {
    replaceAllByLabel(headers, row, label, value);
  });

  return { row, email, phone, schoolCode };
}

function normalizeAnswer(questionType, rawValue) {
  const value = String(rawValue ?? "").trim();
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
    if (!String(value).trim()) return;

    fields[`c${String(index).padStart(3, "0")}`] = {
      label,
      value,
    };
  });

  return { fields };
}

async function countRows(supabase, table, configure = (query) => query) {
  const query = configure(
    supabase.from(table).select("*", { count: "exact", head: true }),
  );
  const result = await query;
  throwIfError(result, `Count ${table}`);
  return result.count ?? 0;
}

async function listAllAuthUsers(supabase) {
  const users = [];

  for (let page = 1; page <= 100; page += 1) {
    const result = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (result.error) {
      throw new Error(`List Auth users: ${result.error.message}`);
    }

    users.push(...result.data.users);

    if (result.data.users.length < 1000) break;
  }

  return users;
}

async function findSourceCycle(supabase, requestedCycleKey) {
  if (requestedCycleKey) {
    const requested = await supabase
      .from("award_cycles")
      .select("*")
      .eq("cycle_key", requestedCycleKey)
      .maybeSingle();

    const data = throwIfError(requested, "Find requested source cycle");
    if (!data) {
      throw new Error(`Source cycle not found: ${requestedCycleKey}`);
    }
    return data;
  }

  const preferred = await supabase
    .from("award_cycles")
    .select("*")
    .eq("cycle_key", "2025-2026-directors")
    .maybeSingle();

  const preferredData = throwIfError(
    preferred,
    "Find preferred 2025-2026 Director cycle",
  );
  if (preferredData) return preferredData;

  const fallback = await supabase
    .from("award_cycles")
    .select("*")
    .eq("program_type", "directors")
    .neq("cycle_key", TARGET_CYCLE_KEY)
    .order("season_year", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fallbackData = throwIfError(fallback, "Find latest Director cycle");
  if (!fallbackData) {
    throw new Error(
      "No existing Director program was found to clone. Import or create the current Director form first.",
    );
  }

  return fallbackData;
}

async function findSourceForm(supabase, sourceCycleId) {
  const result = await supabase
    .from("application_form_versions")
    .select("*")
    .eq("cycle_id", sourceCycleId)
    .order("status", { ascending: false })
    .order("version_number", { ascending: false })
    .limit(1);

  const rows = throwIfError(result, "Find source application form");
  if (!rows[0]) {
    throw new Error("The source Director program does not have an application form.");
  }

  const published = rows.find((row) => row.status === "published");
  return published ?? rows[0];
}

async function findSourceRubric(supabase, sourceCycleId) {
  const result = await supabase
    .from("scoring_rubrics")
    .select("*")
    .eq("cycle_id", sourceCycleId)
    .order("version_number", { ascending: false });

  const rows = throwIfError(result, "Find source scoring rubric");
  if (rows.length === 0) {
    throw new Error("The source Director program does not have a scoring rubric.");
  }

  return rows.find((row) => row.status === "published") ?? rows[0];
}

async function ensureTargetCycle(supabase, sourceCycle) {
  const existing = await supabase
    .from("award_cycles")
    .select("*")
    .eq("cycle_key", TARGET_CYCLE_KEY)
    .maybeSingle();

  const existingCycle = throwIfError(existing, "Find target cycle");

  if (existingCycle) {
    const nonDemoCount = await countRows(
      supabase,
      "applications",
      (query) =>
        query
          .eq("cycle_id", existingCycle.id)
          .or(`source_system.is.null,source_system.neq.${DEMO_SOURCE_SYSTEM}`),
    );

    if (nonDemoCount > 0) {
      throw new Error(
        `The ${TARGET_SEASON} target cycle already contains ${nonDemoCount} non-demo application(s). ` +
          "The rollover stopped without modifying them.",
      );
    }

    return throwIfError(
      await supabase
        .from("award_cycles")
        .update({
          name: TARGET_CYCLE_NAME,
          season_year: TARGET_SEASON,
          program_type: "directors",
          description:
            sourceCycle.description ??
            "Georgia High School Musical Theatre Awards Director Application.",
          status: "open",
          is_active: true,
          opens_at: new Date().toISOString(),
          closes_at: "2027-06-30T23:59:59-04:00",
          source_system: "season-rollover",
          source_program_name: TARGET_CYCLE_NAME,
          cloned_from_cycle_id: sourceCycle.id,
        })
        .eq("id", existingCycle.id)
        .select("*")
        .single(),
      "Refresh target cycle",
    );
  }

  return throwIfError(
    await supabase
      .from("award_cycles")
      .insert({
        cycle_key: TARGET_CYCLE_KEY,
        name: TARGET_CYCLE_NAME,
        season_year: TARGET_SEASON,
        program_type: "directors",
        description:
          sourceCycle.description ??
          "Georgia High School Musical Theatre Awards Director Application.",
        status: "open",
        is_active: true,
        opens_at: new Date().toISOString(),
        closes_at: "2027-06-30T23:59:59-04:00",
        source_system: "season-rollover",
        source_program_name: TARGET_CYCLE_NAME,
        cloned_from_cycle_id: sourceCycle.id,
      })
      .select("*")
      .single(),
    "Create target cycle",
  );
}

async function cloneFormIfNeeded(supabase, sourceForm, targetCycleId) {
  const existing = await supabase
    .from("application_form_versions")
    .select("*")
    .eq("cycle_id", targetCycleId)
    .order("version_number", { ascending: false });

  const targetForms = throwIfError(existing, "Read target forms");
  const existingPublished = targetForms.find((form) => form.status === "published");

  if (existingPublished) return existingPublished;

  let targetForm = targetForms[0];

  if (!targetForm) {
    targetForm = throwIfError(
      await supabase
        .from("application_form_versions")
        .insert({
          cycle_id: targetCycleId,
          version_number: 1,
          name: TARGET_FORM_NAME,
          status: "draft",
          cloned_from_form_version_id: sourceForm.id,
          source_system: "season-rollover",
          source_program_name: TARGET_CYCLE_NAME,
        })
        .select("*")
        .single(),
      "Create target form",
    );

    const sourceStages = throwIfError(
      await supabase
        .from("application_stages")
        .select("*")
        .eq("form_version_id", sourceForm.id)
        .order("sort_order")
        .order("created_at"),
      "Read source stages",
    );

    const sourceSections = throwIfError(
      await supabase
        .from("application_sections")
        .select("*")
        .eq("form_version_id", sourceForm.id)
        .order("sort_order")
        .order("created_at"),
      "Read source sections",
    );

    const sourceQuestions = throwIfError(
      await supabase
        .from("application_questions")
        .select("*")
        .eq("form_version_id", sourceForm.id)
        .order("sort_order")
        .order("created_at"),
      "Read source questions",
    );

    const stageMap = new Map();
    for (const stage of sourceStages) {
      const inserted = throwIfError(
        await supabase
          .from("application_stages")
          .insert({
            form_version_id: targetForm.id,
            stage_key: stage.stage_key,
            title: stage.title,
            description: stage.description,
            sort_order: stage.sort_order,
            is_initial: stage.is_initial,
            applicant_visible: stage.applicant_visible,
            opens_at: null,
            closes_at: null,
            settings: stage.settings ?? {},
          })
          .select("id")
          .single(),
        `Clone stage ${stage.title}`,
      );
      stageMap.set(stage.id, inserted.id);
    }

    const sectionMap = new Map();
    for (const section of sourceSections) {
      const inserted = throwIfError(
        await supabase
          .from("application_sections")
          .insert({
            form_version_id: targetForm.id,
            stage_id: section.stage_id
              ? stageMap.get(section.stage_id) ?? null
              : null,
            title: section.title,
            description: section.description,
            sort_order: section.sort_order,
          })
          .select("id")
          .single(),
        `Clone section ${section.title}`,
      );
      sectionMap.set(section.id, inserted.id);
    }

    for (let index = 0; index < sourceQuestions.length; index += 250) {
      const batch = sourceQuestions
        .slice(index, index + 250)
        .map((question) => ({
          form_version_id: targetForm.id,
          section_id: sectionMap.get(question.section_id),
          question_key: question.question_key,
          label: question.label,
          description: question.description,
          question_type: question.question_type,
          required: question.required,
          options: question.options ?? [],
          settings: question.settings ?? {},
          visibility_rule: question.visibility_rule ?? {},
          sort_order: question.sort_order,
          active: question.active,
          source_column_index: question.source_column_index,
          source_label: question.source_label,
          imported: question.imported,
        }));

      throwIfError(
        await supabase.from("application_questions").insert(batch),
        `Clone question batch ${index / 250 + 1}`,
      );
    }
  }

  return throwIfError(
    await supabase
      .from("application_form_versions")
      .update({
        name: TARGET_FORM_NAME,
        status: "published",
        published_at: new Date().toISOString(),
      })
      .eq("id", targetForm.id)
      .select("*")
      .single(),
    "Publish target form",
  );
}

async function cloneRubricIfNeeded(supabase, sourceRubric, targetCycleId) {
  const existing = await supabase
    .from("scoring_rubrics")
    .select("*")
    .eq("cycle_id", targetCycleId)
    .order("version_number", { ascending: false });

  const targetRubrics = throwIfError(existing, "Read target rubrics");
  const existingPublished = targetRubrics.find(
    (rubric) => rubric.status === "published",
  );

  if (existingPublished) return existingPublished;

  let targetRubric = targetRubrics[0];

  if (!targetRubric) {
    targetRubric = throwIfError(
      await supabase
        .from("scoring_rubrics")
        .insert({
          cycle_id: targetCycleId,
          name: TARGET_RUBRIC_NAME,
          version_number: 1,
          status: "draft",
          score_min: sourceRubric.score_min,
          score_max: sourceRubric.score_max,
          source_system: "season-rollover",
        })
        .select("*")
        .single(),
      "Create target rubric",
    );

    const levels = throwIfError(
      await supabase
        .from("scoring_scale_levels")
        .select("*")
        .eq("rubric_id", sourceRubric.id)
        .order("sort_order"),
      "Read source scoring scale",
    );

    if (levels.length > 0) {
      throwIfError(
        await supabase.from("scoring_scale_levels").insert(
          levels.map((level) => ({
            rubric_id: targetRubric.id,
            score: level.score,
            label: level.label,
            description: level.description,
            sort_order: level.sort_order,
          })),
        ),
        "Clone scoring scale",
      );
    }

    const categories = throwIfError(
      await supabase
        .from("scoring_categories")
        .select("*")
        .eq("rubric_id", sourceRubric.id)
        .order("sort_order"),
      "Read source scoring categories",
    );

    for (const category of categories) {
      const insertedCategory = throwIfError(
        await supabase
          .from("scoring_categories")
          .insert({
            rubric_id: targetRubric.id,
            category_key: category.category_key,
            title: category.title,
            description: category.description,
            guidance: category.guidance,
            subject_label: category.subject_label,
            sort_order: category.sort_order,
            required: category.required,
            allow_not_applicable: category.allow_not_applicable,
            active: category.active,
          })
          .select("id")
          .single(),
        `Clone scoring category ${category.title}`,
      );

      const criteria = throwIfError(
        await supabase
          .from("scoring_criteria")
          .select("*")
          .eq("category_id", category.id)
          .order("sort_order"),
        `Read criteria for ${category.title}`,
      );

      if (criteria.length > 0) {
        throwIfError(
          await supabase.from("scoring_criteria").insert(
            criteria.map((criterion) => ({
              category_id: insertedCategory.id,
              criterion_key: criterion.criterion_key,
              title: criterion.title,
              description: criterion.description,
              weight: criterion.weight,
              sort_order: criterion.sort_order,
              active: criterion.active,
            })),
          ),
          `Clone criteria for ${category.title}`,
        );
      }
    }
  }

  return throwIfError(
    await supabase
      .from("scoring_rubrics")
      .update({
        name: TARGET_RUBRIC_NAME,
        status: "published",
      })
      .eq("id", targetRubric.id)
      .select("*")
      .single(),
    "Publish target rubric",
  );
}

async function cloneAiPromptTemplates(supabase, sourceCycleId, targetCycleId) {
  const targetCount = await countRows(
    supabase,
    "ai_prompt_templates",
    (query) => query.eq("cycle_id", targetCycleId),
  );
  if (targetCount > 0) return;

  const source = await supabase
    .from("ai_prompt_templates")
    .select("*")
    .eq("cycle_id", sourceCycleId)
    .order("version_number");

  if (source.error) {
    if (source.error.code === "42P01") return;
    throw new Error(`Read source AI prompts: ${source.error.message}`);
  }

  if (source.data.length === 0) return;

  throwIfError(
    await supabase.from("ai_prompt_templates").insert(
      source.data.map((prompt) => ({
        cycle_id: targetCycleId,
        template_key: prompt.template_key,
        name: prompt.name,
        system_prompt: prompt.system_prompt,
        user_prompt_template: prompt.user_prompt_template,
        model: prompt.model,
        active: prompt.active,
        version_number: prompt.version_number,
      })),
    ),
    "Clone AI prompt templates",
  );
}

async function archiveExistingSeasonData(supabase, targetCycleId) {
  const archivedAt = new Date().toISOString();

  throwIfError(
    await supabase
      .from("applications")
      .update({
        is_archived: true,
        archived_at: archivedAt,
        archived_by: null,
        archive_reason: ARCHIVE_REASON,
      })
      .neq("cycle_id", targetCycleId)
      .eq("is_archived", false),
    "Archive existing applications",
  );

  throwIfError(
    await supabase
      .from("application_form_versions")
      .update({ status: "archived" })
      .neq("cycle_id", targetCycleId)
      .neq("status", "archived"),
    "Archive existing forms",
  );

  throwIfError(
    await supabase
      .from("scoring_rubrics")
      .update({ status: "archived" })
      .neq("cycle_id", targetCycleId)
      .neq("status", "archived"),
    "Archive existing rubrics",
  );

  throwIfError(
    await supabase
      .from("schedule_slots")
      .update({ status: "closed" })
      .neq("cycle_id", targetCycleId)
      .in("status", ["draft", "open"]),
    "Close existing schedule slots",
  );

  const waitlists = await supabase
    .from("schedule_date_waitlist")
    .update({ status: "expired" })
    .neq("cycle_id", targetCycleId)
    .in("status", ["waiting", "offered"]);

  if (waitlists.error && waitlists.error.code !== "42P01") {
    throw new Error(`Expire existing waitlists: ${waitlists.error.message}`);
  }

  throwIfError(
    await supabase
      .from("award_cycles")
      .update({
        is_active: false,
        status: "archived",
      })
      .neq("id", targetCycleId),
    "Archive existing programs",
  );

  throwIfError(
    await supabase
      .from("award_cycles")
      .update({
        is_active: true,
        status: "open",
      })
      .eq("id", targetCycleId),
    "Activate target program",
  );
}

async function findOrCreateAuthUser(
  supabase,
  allUsers,
  email,
  password,
  fullName,
) {
  const normalizedEmail = email.trim().toLowerCase();
  let user = allUsers.find(
    (candidate) => candidate.email?.toLowerCase() === normalizedEmail,
  );

  if (!user) {
    const created = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        demo_account: true,
        demo_season: TARGET_SEASON,
      },
    });

    if (created.error || !created.data.user) {
      throw new Error(
        `Create demo user ${normalizedEmail}: ${
          created.error?.message ?? "Unknown error"
        }`,
      );
    }

    user = created.data.user;
    allUsers.push(user);
  } else {
    const updated = await supabase.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...(user.user_metadata ?? {}),
        full_name: fullName,
        demo_account: true,
        demo_season: TARGET_SEASON,
      },
    });

    if (updated.error || !updated.data.user) {
      throw new Error(
        `Refresh demo user ${normalizedEmail}: ${
          updated.error?.message ?? "Unknown error"
        }`,
      );
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
      force_password_reset: false,
      password_reset_requested_at: null,
    }),
    `Upsert demo profile ${normalizedEmail}`,
  );

  return user;
}

async function ensureSchool(supabase, school, schoolCode) {
  const existing = await supabase
    .from("schools")
    .select("*")
    .eq("school_code", schoolCode)
    .maybeSingle();

  const existingSchool = throwIfError(existing, `Find ${school.school}`);

  const payload = {
    name: school.school,
    city: school.city,
    county: school.county,
    school_code: schoolCode,
    active: true,
  };

  if (existingSchool) {
    return throwIfError(
      await supabase
        .from("schools")
        .update(payload)
        .eq("id", existingSchool.id)
        .select("*")
        .single(),
      `Refresh ${school.school}`,
    );
  }

  return throwIfError(
    await supabase.from("schools").insert(payload).select("*").single(),
    `Create ${school.school}`,
  );
}

async function ensureDemoApplication({
  supabase,
  targetCycle,
  targetForm,
  user,
  schoolRecord,
  school,
  schoolCode,
  email,
  headers,
  row,
  stages,
}) {
  const sourceRecordId = `DEMO-2627-${String(school.index).padStart(3, "0")}`;
  const now = new Date().toISOString();
  const lastVisibleStage = [...stages]
    .filter((stage) => stage.applicant_visible)
    .sort((a, b) => b.sort_order - a.sort_order)[0];

  const payload = {
    cycle_id: targetCycle.id,
    form_version_id: targetForm.id,
    applicant_user_id: user.id,
    school_id: schoolRecord.id,
    school_name: school.school,
    production_title: school.production,
    status: "submitted",
    submitted_at: now,
    form_data: {
      demo_seed: true,
      demo_season: TARGET_SEASON,
      demo_school_code: schoolCode,
      login_email: email,
      note: "Fictional GHSMTA demo data. Do not use for production decisions.",
    },
    current_stage_id: lastVisibleStage?.id ?? null,
    external_applicant_name: `${school.first} ${school.last}`,
    external_applicant_email: email,
    source_system: DEMO_SOURCE_SYSTEM,
    source_record_id: sourceRecordId,
    source_stage: "Submitted Demo Application",
    is_archived: false,
    archived_at: null,
    archived_by: null,
    archive_reason: null,
    archived_payload: rawPayload(headers, row),
  };

  const existingBySource = await supabase
    .from("applications")
    .select("id")
    .eq("source_system", DEMO_SOURCE_SYSTEM)
    .eq("source_record_id", sourceRecordId)
    .maybeSingle();

  const existing = throwIfError(
    existingBySource,
    `Find demo application ${sourceRecordId}`,
  );

  if (existing) {
    return throwIfError(
      await supabase
        .from("applications")
        .update(payload)
        .eq("id", existing.id)
        .select("id")
        .single(),
      `Refresh demo application ${sourceRecordId}`,
    );
  }

  const otherActive = await supabase
    .from("applications")
    .select("id")
    .eq("cycle_id", targetCycle.id)
    .eq("applicant_user_id", user.id)
    .eq("is_archived", false);

  const otherRows = throwIfError(
    otherActive,
    `Find other active application for ${email}`,
  );

  if (otherRows.length > 0) {
    throwIfError(
      await supabase
        .from("applications")
        .update({
          is_archived: true,
          archived_at: now,
          archived_by: null,
          archive_reason: "Replaced by refreshed 2026–2027 demo application.",
        })
        .in(
          "id",
          otherRows.map((application) => application.id),
        ),
      `Archive prior demo application for ${email}`,
    );
  }

  return throwIfError(
    await supabase.from("applications").insert(payload).select("id").single(),
    `Create demo application ${sourceRecordId}`,
  );
}

async function importAnswers({
  supabase,
  formId,
  applicationId,
  row,
}) {
  const questions = throwIfError(
    await supabase
      .from("application_questions")
      .select("id,question_type,source_column_index")
      .eq("form_version_id", formId)
      .eq("active", true)
      .not("source_column_index", "is", null)
      .order("source_column_index"),
    "Read target form questions",
  );

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

  for (let index = 0; index < answers.length; index += 350) {
    throwIfError(
      await supabase
        .from("application_answers")
        .upsert(answers.slice(index, index + 350), {
          onConflict: "application_id,question_id",
        }),
      `Upsert demo answer batch ${index / 350 + 1}`,
    );
  }

  return answers.length;
}

async function completeStages(supabase, applicationId, stages) {
  const completedAt = new Date().toISOString();

  throwIfError(
    await supabase.from("application_stage_progress").upsert(
      stages.map((stage) => ({
        application_id: applicationId,
        stage_id: stage.id,
        status: "complete",
        started_at: completedAt,
        submitted_at: completedAt,
        completed_at: completedAt,
        reopened_at: null,
      })),
      {
        onConflict: "application_id,stage_id",
      },
    ),
    "Complete demo application stages",
  );
}

async function ensureScheduleSlots(supabase, targetCycleId) {
  const existing = await supabase
    .from("schedule_slots")
    .select("id,title")
    .eq("cycle_id", targetCycleId)
    .ilike("title", "DEMO 2026–2027%");

  const existingSlots = throwIfError(existing, "Read demo schedule slots");
  if (existingSlots.length >= 12) return existingSlots.length;

  const dates = [
    ["2026-10-17T13:00:00-04:00", "2026-10-17T15:30:00-04:00"],
    ["2026-10-17T18:30:00-04:00", "2026-10-17T21:00:00-04:00"],
    ["2026-10-18T13:00:00-04:00", "2026-10-18T15:30:00-04:00"],
    ["2026-10-18T18:30:00-04:00", "2026-10-18T21:00:00-04:00"],
    ["2026-10-24T13:00:00-04:00", "2026-10-24T15:30:00-04:00"],
    ["2026-10-24T18:30:00-04:00", "2026-10-24T21:00:00-04:00"],
    ["2026-10-25T13:00:00-04:00", "2026-10-25T15:30:00-04:00"],
    ["2026-10-25T18:30:00-04:00", "2026-10-25T21:00:00-04:00"],
    ["2026-10-31T13:00:00-04:00", "2026-10-31T15:30:00-04:00"],
    ["2026-10-31T18:30:00-04:00", "2026-10-31T21:00:00-04:00"],
    ["2026-11-01T13:00:00-05:00", "2026-11-01T15:30:00-05:00"],
    ["2026-11-01T18:30:00-05:00", "2026-11-01T21:00:00-05:00"],
  ];

  const existingTitles = new Set(existingSlots.map((slot) => slot.title));
  const rows = dates
    .map(([startsAt, endsAt], index) => ({
      cycle_id: targetCycleId,
      title: `DEMO 2026–2027 Adjudication Slot ${String(index + 1).padStart(2, "0")}`,
      starts_at: startsAt,
      ends_at: endsAt,
      location: "School venue — details supplied after booking",
      school_instructions:
        "DEMO SLOT: The school will add venue, parking, arrival, and Wi-Fi details after booking.",
      status: "open",
      school_booking_opens_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      school_booking_closes_at: new Date(
        new Date(startsAt).getTime() - 24 * 60 * 60 * 1000,
      ).toISOString(),
    }))
    .filter((row) => !existingTitles.has(row.title));

  if (rows.length > 0) {
    throwIfError(
      await supabase.from("schedule_slots").insert(rows),
      "Create demo schedule slots",
    );
  }

  return existingSlots.length + rows.length;
}

async function preview(supabase, sourceCycle) {
  const counts = {
    applications: await countRows(
      supabase,
      "applications",
      (query) => query.eq("is_archived", false),
    ),
    programs: await countRows(
      supabase,
      "award_cycles",
      (query) => query.neq("status", "archived"),
    ),
    scheduleSlots: await countRows(
      supabase,
      "schedule_slots",
      (query) => query.in("status", ["draft", "open"]),
    ),
  };

  console.log("\n2026–2027 season rollover preview\n");
  console.log(`Source program: ${sourceCycle.name} (${sourceCycle.cycle_key})`);
  console.log(`Active applications to archive: ${counts.applications}`);
  console.log(`Programs to archive: ${counts.programs}`);
  console.log(`Draft/open schedule slots to close: ${counts.scheduleSlots}`);
  console.log("New live program: 2026–2027 Director Application");
  console.log("Demo applicant accounts: 10");
  console.log("Open demo scheduling slots: 12");
  console.log("\nNo database changes were made.");
  console.log("Run again with --apply to perform the rollover.\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = Boolean(args.apply);
  const withSchedule = !args["no-schedule"];
  const password = String(args.password ?? DEFAULT_PASSWORD);
  const sourceCycleKey = args["source-cycle-key"]
    ? String(args["source-cycle-key"])
    : null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env.local.",
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const templateFile = path.resolve(
    process.cwd(),
    "data/2026-2027-demo-application-template.csv",
  );
  if (!fs.existsSync(templateFile)) {
    throw new Error(`Demo application template not found: ${templateFile}`);
  }

  const sourceCycle = await findSourceCycle(supabase, sourceCycleKey);

  if (!apply) {
    await preview(supabase, sourceCycle);
    return;
  }

  console.log("\nPreparing the 2026–2027 GHSMTA demo season…\n");

  const sourceForm = await findSourceForm(supabase, sourceCycle.id);
  const sourceRubric = await findSourceRubric(supabase, sourceCycle.id);

  console.log("1/7 Creating the 2026–2027 Director program…");
  const targetCycle = await ensureTargetCycle(supabase, sourceCycle);

  console.log("2/7 Cloning and publishing the application form…");
  const targetForm = await cloneFormIfNeeded(
    supabase,
    sourceForm,
    targetCycle.id,
  );

  console.log("3/7 Cloning and publishing the scoring rubric…");
  const targetRubric = await cloneRubricIfNeeded(
    supabase,
    sourceRubric,
    targetCycle.id,
  );

  await cloneAiPromptTemplates(supabase, sourceCycle.id, targetCycle.id);

  console.log("4/7 Archiving prior applications, programs, forms, and schedules…");
  await archiveExistingSeasonData(supabase, targetCycle.id);

  const { headers, row: templateRow } = readSingleRowCsv(templateFile);
  const stages = throwIfError(
    await supabase
      .from("application_stages")
      .select("id,title,sort_order,applicant_visible")
      .eq("form_version_id", targetForm.id)
      .order("sort_order"),
    "Read target application stages",
  );

  if (stages.length === 0) {
    throw new Error("The cloned 2026–2027 application form has no stages.");
  }

  console.log("5/7 Creating ten demo school accounts and applications…");
  const allUsers = await listAllAuthUsers(supabase);
  const createdSchools = [];

  for (const school of DEMO_SCHOOLS) {
    const customized = customizeTemplateRow(headers, templateRow, school);
    const fullName = `${school.first} ${school.last}`;

    const user = await findOrCreateAuthUser(
      supabase,
      allUsers,
      customized.email,
      password,
      fullName,
    );

    const schoolRecord = await ensureSchool(
      supabase,
      school,
      customized.schoolCode,
    );

    const application = await ensureDemoApplication({
      supabase,
      targetCycle,
      targetForm,
      user,
      schoolRecord,
      school,
      schoolCode: customized.schoolCode,
      email: customized.email,
      headers,
      row: customized.row,
      stages,
    });

    const answerCount = await importAnswers({
      supabase,
      formId: targetForm.id,
      applicationId: application.id,
      row: customized.row,
    });

    await completeStages(supabase, application.id, stages);

    createdSchools.push({
      school: school.school,
      production: school.production,
      email: customized.email,
      applicationId: application.id,
      answerCount,
    });

    console.log(
      `  ✓ ${school.school} — ${customized.email} (${answerCount} answers)`,
    );
  }

  let scheduleSlotCount = 0;
  if (withSchedule) {
    console.log("6/7 Creating twelve open realtime scheduling slots…");
    scheduleSlotCount = await ensureScheduleSlots(supabase, targetCycle.id);
  } else {
    console.log("6/7 Schedule slot creation skipped.");
  }

  console.log("7/7 Verifying the live season…");
  const liveApplications = await countRows(
    supabase,
    "applications",
    (query) =>
      query
        .eq("cycle_id", targetCycle.id)
        .eq("is_archived", false)
        .eq("source_system", DEMO_SOURCE_SYSTEM),
  );

  console.log("\n2026–2027 demo season is ready.\n");
  console.log(`Program: ${targetCycle.name}`);
  console.log(`Cycle key: ${targetCycle.cycle_key}`);
  console.log(`Published form: ${targetForm.name}`);
  console.log(`Published rubric: ${targetRubric.name}`);
  console.log(`Live demo applications: ${liveApplications}`);
  console.log(`Open demo schedule slots: ${withSchedule ? scheduleSlotCount : "skipped"}`);
  console.log(`Shared demo password: ${password}`);
  console.log("\nLogin accounts:");
  for (const school of createdSchools) {
    console.log(`  ${school.email} — ${school.school}`);
  }
  console.log(
    "\nThe credential sheet is data/2026-2027-demo-school-logins.csv\n",
  );
}

main().catch((error) => {
  console.error("\nSeason rollover failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
