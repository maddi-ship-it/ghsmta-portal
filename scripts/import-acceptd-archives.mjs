#!/usr/bin/env node

/**
 * Imports the complete 2025–2026 Acceptd Director export as a staged,
 * read-only historical form and imports the archived Section D export as a
 * second historical program.
 *
 * Required local-only environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/import-acceptd-archives.mjs \
 *     --director "/path/to/acceptd_Application.csv" \
 *     --questions "/path/to/acceptd_ApplicationQuestion.csv" \
 *     --archive "/path/to/acceptd_ArchivedApplication.csv"
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
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = value;
      index += 1;
    }
  }
  return result;
}

// RFC 4180-compatible parser with support for escaped quotes and embedded
// newlines. This avoids adding another npm package to the portal.
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

function readCsv(filename) {
  const text = fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, "");
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error(`No data rows found in ${filename}`);
  const [headers, ...dataRows] = rows;
  return {
    headers,
    rows: dataRows.filter((row) => row.some((value) => value.trim() !== "")),
  };
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

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72) || "field";
}

function questionKey(columnIndex, label) {
  return `acceptd_c${String(columnIndex).padStart(3, "0")}_${slugify(label)}`;
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function looksLikeDate(values) {
  if (values.length === 0) return false;
  const matches = values.filter((value) =>
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/.test(value),
  );
  return matches.length / values.length >= 0.75;
}

function looksLikeNumber(values) {
  if (values.length === 0) return false;
  const matches = values.filter((value) =>
    /^\s*[$-]?[\d,]+(?:\.\d+)?%?\s*$/.test(value),
  );
  return matches.length / values.length >= 0.85;
}

function inferQuestion(label, values) {
  const nonEmpty = values.map((value) => value.trim()).filter(Boolean);
  const unique = uniqueNonEmpty(nonEmpty);
  const lower = label.toLowerCase();
  const averageLength =
    nonEmpty.length === 0
      ? 0
      : nonEmpty.reduce((sum, value) => sum + value.length, 0) / nonEmpty.length;

  if (nonEmpty.length === 0) {
    return { type: "content", options: [] };
  }

  if (nonEmpty.some((value) => value.includes("|"))) {
    const options = uniqueNonEmpty(
      nonEmpty.flatMap((value) => value.split("|").map((part) => part.trim())),
    );
    return { type: "multi_select", options };
  }

  if (/e-?mail/.test(lower)) return { type: "email", options: [] };
  if (/(phone|cellphone|cell phone)/.test(lower)) {
    return { type: "phone", options: [] };
  }

  if (/(date of birth|birth date|opening night date|closing night date)/.test(lower)) {
    return { type: "date", options: [] };
  }

  if (looksLikeDate(nonEmpty)) return { type: "date", options: [] };

  if (
    /(amount|quantity|total number|how many|percentage|mileage|family size|compensation|\$)/.test(
      lower,
    ) &&
    looksLikeNumber(nonEmpty)
  ) {
    return { type: "number", options: [] };
  }

  const normalized = unique.map((value) => value.toLowerCase());
  const yesNoLike = normalized.every((value) =>
    /^(yes|no|n\/a|not applicable|not-applicable|i acknowledge|i agree)/.test(value),
  );
  if (unique.length <= 6 && yesNoLike) {
    return unique.length <= 2
      ? { type: "yes_no", options: unique }
      : { type: "radio", options: unique };
  }

  if (averageLength >= 120 || /describe|explain|essay|response|vision|comments|bio/.test(lower)) {
    return { type: "long_text", options: [] };
  }

  if (unique.length >= 2 && unique.length <= 18 && unique.every((value) => value.length <= 90)) {
    return { type: "select", options: unique };
  }

  return { type: "short_text", options: [] };
}

function normalizeAnswer(questionType, rawValue) {
  const value = rawValue.trim();
  if (!value) return null;
  if (questionType === "multi_select") {
    return value.split("|").map((part) => part.trim()).filter(Boolean);
  }
  if (questionType === "number") {
    const parsed = Number(value.replace(/[$,%]/g, "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (questionType === "checkbox" || questionType === "signature_acknowledgement") {
    return /^(yes|true|1|i agree|i acknowledge)/i.test(value);
  }
  return value;
}

function parseAcceptdDate(value) {
  if (!value) return null;
  const cleaned = value
    .replace(/\s+(EDT|EST)$/, (match) => (match.includes("EDT") ? " -04:00" : " -05:00"))
    .replace(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\s+/, (_, month, day, year) => {
      const numericYear = Number(year);
      return `${String(2000 + numericYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} `;
    });
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function rawPayload(headers, row) {
  const fields = {};
  headers.forEach((label, index) => {
    const value = row[index] ?? "";
    if (!value) return;
    fields[`c${String(index).padStart(3, "0")}`] = { label, value };
  });
  return { fields };
}

async function chunked(items, size, callback) {
  for (let index = 0; index < items.length; index += size) {
    await callback(items.slice(index, index + size), index / size + 1);
  }
}

function throwIfError(result, context) {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
  return result.data;
}

async function ensureCycle(supabase, input, options = {}) {
  const existingResult = await supabase
    .from("award_cycles")
    .select("id")
    .eq("cycle_key", input.cycle_key)
    .maybeSingle();
  throwIfError(existingResult, `Find ${input.cycle_key}`);

  let existingId = existingResult.data?.id ?? null;

  if (!existingId && options.reuseExistingBySeason) {
    const seasonMatch = await supabase
      .from("award_cycles")
      .select("id")
      .eq("season_year", input.season_year)
      .eq("program_type", input.program_type)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    throwIfError(seasonMatch, `Find existing ${input.season_year} ${input.program_type} program`);
    existingId = seasonMatch.data?.id ?? null;
  }

  if (existingId) {
    const updateResult = await supabase
      .from("award_cycles")
      .update(input)
      .eq("id", existingId)
      .select("id")
      .single();
    return throwIfError(updateResult, `Update ${input.cycle_key}`);
  }

  const insertResult = await supabase
    .from("award_cycles")
    .insert(input)
    .select("id")
    .single();
  return throwIfError(insertResult, `Create ${input.cycle_key}`);
}


async function removeLegacySectionASeed(supabase, cycleId) {
  const seedForms = await supabase
    .from("application_form_versions")
    .select("id,name")
    .eq("cycle_id", cycleId)
    .eq("name", "2025–2026 Director Application Import");
  throwIfError(seedForms, "Find the temporary Section A seed form");

  for (const form of seedForms.data ?? []) {
    const applications = await supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("form_version_id", form.id);
    throwIfError(applications, "Check the temporary Section A seed form");
    if ((applications.count ?? 0) === 0) {
      throwIfError(
        await supabase.from("application_form_versions").delete().eq("id", form.id),
        "Remove the temporary Section A seed form",
      );
    }
  }
}

async function ensureImportedForm(supabase, cycleId, name, sourceProgramName) {
  const existing = await supabase
    .from("application_form_versions")
    .select("id,version_number")
    .eq("cycle_id", cycleId)
    .eq("name", name)
    .maybeSingle();
  throwIfError(existing, `Find form ${name}`);

  if (existing.data) return existing.data;

  const versions = await supabase
    .from("application_form_versions")
    .select("version_number")
    .eq("cycle_id", cycleId)
    .order("version_number", { ascending: false })
    .limit(1);
  throwIfError(versions, `Read versions for ${name}`);
  const nextVersion = (versions.data?.[0]?.version_number ?? 0) + 1;

  const inserted = await supabase
    .from("application_form_versions")
    .insert({
      cycle_id: cycleId,
      version_number: nextVersion,
      name,
      status: "archived",
      source_system: "acceptd",
      source_program_name: sourceProgramName,
    })
    .select("id,version_number")
    .single();
  return throwIfError(inserted, `Create form ${name}`);
}

async function replaceImportedDefinition(supabase, formVersionId) {
  const applications = await supabase
    .from("applications")
    .select("id")
    .eq("form_version_id", formVersionId);
  throwIfError(applications, "Find previously imported applications");
  const applicationIds = (applications.data ?? []).map((item) => item.id);

  if (applicationIds.length > 0) {
    await chunked(applicationIds, 100, async (ids) => {
      throwIfError(
        await supabase.from("applications").delete().in("id", ids),
        "Delete previously imported applications",
      );
    });
  }

  throwIfError(
    await supabase
      .from("application_stages")
      .delete()
      .eq("form_version_id", formVersionId),
    "Replace imported form definition",
  );
}

async function createStagesAndSections(supabase, formVersionId, stageDefinitions) {
  const stageRows = stageDefinitions.map((stage, index) => ({
    form_version_id: formVersionId,
    stage_key: stage.key,
    title: stage.title,
    description: stage.description ?? null,
    sort_order: (index + 1) * 10,
    is_initial: stage.isInitial ?? index === 0,
    applicant_visible: stage.applicantVisible ?? true,
    settings: {
      source_column_start: stage.start,
      source_column_end: stage.end,
      source_stage_names: stage.sourceStageNames ?? [],
    },
  }));

  const insertedStages = await supabase
    .from("application_stages")
    .insert(stageRows)
    .select("id,stage_key,title,sort_order");
  const stages = throwIfError(insertedStages, "Create stages");

  const stageMap = new Map(stages.map((stage) => [stage.stage_key, stage]));
  const sectionRows = stageDefinitions.map((stage, index) => ({
    form_version_id: formVersionId,
    stage_id: stageMap.get(stage.key).id,
    title: stage.title,
    description: stage.description ?? null,
    sort_order: (index + 1) * 10,
  }));

  const insertedSections = await supabase
    .from("application_sections")
    .insert(sectionRows)
    .select("id,stage_id,title,sort_order");
  const sections = throwIfError(insertedSections, "Create stage sections");
  const sectionMap = new Map(sections.map((section) => [section.stage_id, section]));

  return { stages, stageMap, sectionMap };
}

function questionOverrides(questionExport) {
  if (!questionExport) return new Map();
  const index = new Map();
  const headers = questionExport.headers;
  for (const row of questionExport.rows) {
    const label = valueAt(headers, row, "Question").trim();
    if (!label) continue;
    index.set(label, {
      type: valueAt(headers, row, "Type").trim(),
      required: /^(yes|true|1)$/i.test(valueAt(headers, row, "Required").trim()),
      description: valueAt(headers, row, "Description").trim(),
      visibleValues: valueAt(headers, row, "Visible Values").trim(),
      parentQuestion: valueAt(headers, row, "Parent Question").trim(),
      page: valueAt(headers, row, "Page").trim(),
    });
  }
  return index;
}

function mapAcceptdType(sourceType, inferredType) {
  const normalized = sourceType.toLowerCase();
  if (!normalized) return inferredType;
  if (normalized.includes("paragraph") || normalized.includes("textarea")) return "long_text";
  if (normalized.includes("email")) return "email";
  if (normalized.includes("phone")) return "phone";
  if (normalized.includes("date")) return "date";
  if (normalized.includes("checkbox")) return "multi_select";
  if (normalized.includes("radio")) return "radio";
  if (normalized.includes("dropdown") || normalized.includes("select")) return "select";
  if (normalized.includes("number")) return "number";
  if (normalized.includes("instruction") || normalized.includes("content")) return "content";
  if (normalized.includes("signature")) return "signature_acknowledgement";
  return inferredType;
}

async function importDefinition({
  supabase,
  formVersionId,
  exportData,
  stageDefinitions,
  firstQuestionColumn,
  lastQuestionColumn,
  overrides,
}) {
  const { headers, rows } = exportData;
  const { stages, stageMap, sectionMap } = await createStagesAndSections(
    supabase,
    formVersionId,
    stageDefinitions,
  );

  const stageForColumn = (columnIndex) =>
    stageDefinitions.find(
      (stage) => columnIndex >= stage.start && columnIndex <= stage.end,
    );

  const questionRows = [];
  for (
    let columnIndex = firstQuestionColumn;
    columnIndex <= Math.min(lastQuestionColumn, headers.length - 1);
    columnIndex += 1
  ) {
    const label = headers[columnIndex]?.trim();
    if (!label) continue;
    const stageDefinition = stageForColumn(columnIndex);
    if (!stageDefinition) continue;
    const stage = stageMap.get(stageDefinition.key);
    const section = sectionMap.get(stage.id);
    const values = rows.map((row) => row[columnIndex] ?? "");
    const inferred = inferQuestion(label, values);
    const override = overrides.get(label);
    const type = mapAcceptdType(override?.type ?? "", inferred.type);
    const overrideOptions = override?.visibleValues
      ? override.visibleValues
          .split(/\||\n|;/)
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

    questionRows.push({
      form_version_id: formVersionId,
      section_id: section.id,
      question_key: questionKey(columnIndex, label),
      label,
      description: override?.description || null,
      question_type: type,
      required: override?.required ?? false,
      options: overrideOptions.length > 0 ? overrideOptions : inferred.options,
      settings: {
        acceptd_column_index: columnIndex,
        acceptd_original_label: label,
        acceptd_nonempty_response_count: values.filter((value) => value.trim()).length,
        imported_type_inference: !override?.type,
        ...(override?.page ? { acceptd_page: override.page } : {}),
      },
      visibility_rule: override?.parentQuestion
        ? {
            source_parent_label: override.parentQuestion,
            source_visible_values: override.visibleValues || null,
            requires_manual_review: true,
          }
        : null,
      sort_order: columnIndex * 10,
      active: true,
      source_column_index: columnIndex,
      source_label: label,
      imported: true,
    });
  }

  const createdQuestions = [];
  await chunked(questionRows, 250, async (chunk, chunkNumber) => {
    const result = await supabase
      .from("application_questions")
      .insert(chunk)
      .select("id,source_column_index,question_type,question_key");
    createdQuestions.push(...throwIfError(result, `Create question chunk ${chunkNumber}`));
  });

  return { stages, questions: createdQuestions };
}

function currentStageForSource(stageDefinitions, sourceStage) {
  const normalized = sourceStage.toLowerCase();
  const direct = stageDefinitions.find((stage) =>
    (stage.sourceStageNames ?? []).some(
      (name) => normalized === name.toLowerCase(),
    ),
  );
  if (direct) return direct;

  if (normalized.includes("section d")) return stageDefinitions.at(-1);
  if (normalized.includes("section c")) return stageDefinitions.find((stage) => stage.key.startsWith("section_c"));
  if (normalized.includes("part 3")) return stageDefinitions.find((stage) => stage.key.includes("part_3"));
  if (normalized.includes("part 2")) return stageDefinitions.find((stage) => stage.key.includes("part_2"));
  if (normalized.includes("part 1")) return stageDefinitions.find((stage) => stage.key.includes("part_1"));
  return stageDefinitions[0];
}

async function importApplications({
  supabase,
  exportData,
  cycleId,
  formVersionId,
  sourceNamespace,
  stageDefinitions,
  stages,
  questions,
}) {
  const { headers, rows } = exportData;
  const stageByKey = new Map(stages.map((stage) => [stage.stage_key, stage]));
  const questionByColumn = new Map(
    questions.map((question) => [question.source_column_index, question]),
  );

  const applicationRows = rows.map((row, rowIndex) => {
    const sourceStage = valueAt(headers, row, "Stage") || valueAt(headers, row, "Program");
    const currentStageDefinition = currentStageForSource(stageDefinitions, sourceStage);
    const currentStage = stageByKey.get(currentStageDefinition.key);
    const firstName = valueAt(headers, row, "First Name");
    const lastName = valueAt(headers, row, "Last Name");
    const submittedDate = valueAt(headers, row, "Submitted Date");
    const appId = valueAt(headers, row, "App Id") || `${sourceNamespace}-row-${rowIndex + 1}`;
    const schoolName =
      valueAt(headers, row, "School Name") ||
      valueAt(headers, row, "High School CEEB - Name") ||
      "Unknown school";

    return {
      cycle_id: cycleId,
      form_version_id: formVersionId,
      applicant_user_id: null,
      school_name: schoolName,
      production_title: valueAt(headers, row, "Name of Musical Production") || null,
      status: "complete",
      submitted_at: parseAcceptdDate(submittedDate),
      form_data: {
        imported_from: "acceptd",
        source_program: valueAt(headers, row, "Program") || null,
      },
      current_stage_id: currentStage?.id ?? null,
      external_applicant_name: `${firstName} ${lastName}`.trim() || null,
      external_applicant_email:
        valueAt(headers, row, "Email Address") ||
        valueAt(headers, row, "Work Email Address") ||
        null,
      source_system: sourceNamespace,
      source_record_id: appId,
      source_stage: sourceStage || null,
      is_archived: true,
      archived_payload: rawPayload(headers, row),
    };
  });

  const createdApplications = [];
  await chunked(applicationRows, 50, async (chunk, chunkNumber) => {
    const result = await supabase
      .from("applications")
      .upsert(chunk, { onConflict: "source_system,source_record_id" })
      .select("id,source_record_id,current_stage_id");
    createdApplications.push(
      ...throwIfError(result, `Import application chunk ${chunkNumber}`),
    );
  });

  const applicationBySourceId = new Map(
    createdApplications.map((application) => [application.source_record_id, application]),
  );

  const answerRows = [];
  const progressRows = [];

  rows.forEach((row, rowIndex) => {
    const sourceId = valueAt(headers, row, "App Id") || `${sourceNamespace}-row-${rowIndex + 1}`;
    const application = applicationBySourceId.get(sourceId);
    if (!application) return;

    for (const [columnIndex, question] of questionByColumn.entries()) {
      const rawValue = row[columnIndex] ?? "";
      if (!rawValue.trim() || question.question_type === "content") continue;
      answerRows.push({
        application_id: application.id,
        question_id: question.id,
        value: normalizeAnswer(question.question_type, rawValue),
        updated_by: null,
      });
    }

    const currentStageIndex = Math.max(
      0,
      stages.findIndex((stage) => stage.id === application.current_stage_id),
    );
    stages.forEach((stage, stageIndex) => {
      if (stageIndex > currentStageIndex) return;
      progressRows.push({
        application_id: application.id,
        stage_id: stage.id,
        status: stageIndex < currentStageIndex ? "complete" : "complete",
        started_at: null,
        submitted_at: null,
        completed_at: new Date().toISOString(),
      });
    });
  });

  await chunked(answerRows, 500, async (chunk, chunkNumber) => {
    throwIfError(
      await supabase
        .from("application_answers")
        .upsert(chunk, { onConflict: "application_id,question_id" }),
      `Import answer chunk ${chunkNumber}`,
    );
  });

  await chunked(progressRows, 500, async (chunk, chunkNumber) => {
    throwIfError(
      await supabase
        .from("application_stage_progress")
        .upsert(chunk, { onConflict: "application_id,stage_id" }),
      `Import stage progress chunk ${chunkNumber}`,
    );
  });

  return {
    applications: createdApplications.length,
    answers: answerRows.length,
    progressRows: progressRows.length,
  };
}

async function importDirector2025(supabase, directorFile, questionFile) {
  const director = readCsv(directorFile);
  const questionsExport = questionFile ? readCsv(questionFile) : null;
  const sourceProgramName =
    valueAt(director.headers, director.rows[0], "Program") ||
    "2025-26 GHSMTA Director's Application";

  const stageDefinitions = [
    {
      key: "section_a_application",
      title: "Section A | Application",
      start: 101,
      end: 133,
      sourceStageNames: ["Section A | Application", "Section A | REGEX", "Section A | REGEX Complete", "Section A | Complete"],
    },
    {
      key: "section_b_part_1_preproduction",
      title: "Section B: Part 1 | Pre-Production Information",
      start: 134,
      end: 194,
      sourceStageNames: ["Section B: Part 1 | Pre-Production Information", "Section B Part 1A HOLDING"],
    },
    {
      key: "section_b_part_2_preproduction",
      title: "Section B: Part 2 | Pre-Production Information",
      start: 195,
      end: 341,
      sourceStageNames: ["Section B: Part 2 | Pre-Production Information", "Section A & B Complete | Adjudication Review"],
    },
    {
      key: "section_b_part_3_eligibility",
      title: "Section B: Part 3 | Pre-Production Eligibility",
      start: 342,
      end: 492,
      sourceStageNames: ["Section B: Part 3 | Pre-Production Eligibility"],
    },
    {
      key: "section_c_postproduction",
      title: "Section C | Post-Production",
      start: 493,
      end: 567,
      sourceStageNames: ["Section C | Post-Production", "Section C | Complete"],
    },
    {
      key: "section_d_postnominations",
      title: "Section D | Post-Nominations",
      start: 568,
      end: 812,
      sourceStageNames: ["Section D | Post-Nominations", "Section D | Post Nominations Submitted"],
    },
    {
      key: "recovered_shared_profile_and_scholarship_fields",
      title: "Recovered shared profile and scholarship fields",
      description: "Fields present in the complete Acceptd export before the Director application stages. Preserved for historical completeness and hidden from applicants.",
      start: 20,
      end: 100,
      applicantVisible: false,
      sourceStageNames: [],
    },
  ];

  const cycle = await ensureCycle(supabase, {
    cycle_key: "2025-2026-directors",
    name: "2025–2026 Director Application",
    season_year: "2025-2026",
    program_type: "directors",
    description: "Historical Director Application imported from Acceptd.",
    status: "archived",
    is_active: false,
    source_system: "acceptd",
    source_program_name: sourceProgramName,
  }, { reuseExistingBySeason: true });

  await removeLegacySectionASeed(supabase, cycle.id);

  const form = await ensureImportedForm(
    supabase,
    cycle.id,
    "2025–2026 Director Application — Full Acceptd Import",
    sourceProgramName,
  );
  await replaceImportedDefinition(supabase, form.id);

  const definition = await importDefinition({
    supabase,
    formVersionId: form.id,
    exportData: director,
    stageDefinitions,
    firstQuestionColumn: 20,
    lastQuestionColumn: 812,
    overrides: questionOverrides(questionsExport),
  });

  const imported = await importApplications({
    supabase,
    exportData: director,
    cycleId: cycle.id,
    formVersionId: form.id,
    sourceNamespace: "acceptd-2025-2026-director",
    stageDefinitions,
    stages: definition.stages,
    questions: definition.questions,
  });

  return {
    cycleId: cycle.id,
    formVersionId: form.id,
    stages: definition.stages.length,
    questions: definition.questions.length,
    ...imported,
  };
}

async function importArchive2023(supabase, archiveFile) {
  const archive = readCsv(archiveFile);
  const sourceProgramName =
    valueAt(archive.headers, archive.rows[0], "Program") ||
    "Section D: Post Nomination Application 23-24";
  const lastQuestionColumn = Math.max(0, archive.headers.length - 2);
  const stageDefinitions = [
    {
      key: "section_d_postnominations",
      title: "Section D | Post-Nominations Archive",
      start: 24,
      end: lastQuestionColumn,
      sourceStageNames: [sourceProgramName],
      description:
        "Recovered fields from the Acceptd archived Section D export. Empty legacy columns are preserved as content records and raw source data.",
    },
  ];

  const cycle = await ensureCycle(supabase, {
    cycle_key: "2023-2024-directors-archive",
    name: "2023–2024 Director Application Archive",
    season_year: "2023-2024",
    program_type: "directors",
    description: "Historical Section D archive imported from Acceptd.",
    status: "archived",
    is_active: false,
    source_system: "acceptd",
    source_program_name: sourceProgramName,
  });

  const form = await ensureImportedForm(
    supabase,
    cycle.id,
    "2023–2024 Section D — Acceptd Archive Import",
    sourceProgramName,
  );
  await replaceImportedDefinition(supabase, form.id);

  const definition = await importDefinition({
    supabase,
    formVersionId: form.id,
    exportData: archive,
    stageDefinitions,
    firstQuestionColumn: 24,
    lastQuestionColumn,
    overrides: new Map(),
  });

  const imported = await importApplications({
    supabase,
    exportData: archive,
    cycleId: cycle.id,
    formVersionId: form.id,
    sourceNamespace: "acceptd-2023-2024-section-d",
    stageDefinitions,
    stages: definition.stages,
    questions: definition.questions,
  });

  return {
    cycleId: cycle.id,
    formVersionId: form.id,
    stages: definition.stages.length,
    questions: definition.questions.length,
    ...imported,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.director && !args.archive) {
    throw new Error("Provide --director and/or --archive CSV file paths.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Keep the service role key only in .env.local and never expose it with NEXT_PUBLIC_.",
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const summary = {};
  if (args.director) {
    console.log("Importing the complete 2025–2026 Director application…");
    summary.director2025 = await importDirector2025(
      supabase,
      path.resolve(args.director),
      args.questions ? path.resolve(args.questions) : null,
    );
  }

  if (args.archive) {
    console.log("Importing the archived Section D applications…");
    summary.archive2023 = await importArchive2023(
      supabase,
      path.resolve(args.archive),
    );
  }

  console.log("\nImport complete:");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("\nImport failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
