#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filename) {
  if (!fs.existsSync(filename)) return;
  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rubricPath = path.resolve(process.cwd(), "data/2025-2026-scoring-rubric.json");
const rubricDefinition = JSON.parse(fs.readFileSync(rubricPath, "utf8"));

const { data: cycles, error: cycleError } = await supabase
  .from("award_cycles")
  .select("id,cycle_key,name,season_year,program_type")
  .eq("season_year", rubricDefinition.season_year)
  .eq("program_type", "directors")
  .order("created_at");

if (cycleError) throw cycleError;
if (!cycles || cycles.length === 0) {
  throw new Error("No 2025-2026 directors program exists. Import or create the program first.");
}

for (const cycle of cycles) {
  const { data: existingRubric, error: existingError } = await supabase
    .from("scoring_rubrics")
    .select("id,status")
    .eq("cycle_id", cycle.id)
    .eq("source_system", "ghsmta_2025_2026_workbook")
    .maybeSingle();
  if (existingError) throw existingError;

  let rubricId = existingRubric?.id;

  let archiveQuery = supabase
    .from("scoring_rubrics")
    .update({ status: "archived" })
    .eq("cycle_id", cycle.id)
    .eq("status", "published");

  if (rubricId) archiveQuery = archiveQuery.neq("id", rubricId);
  const { error: archiveError } = await archiveQuery;
  if (archiveError) throw archiveError;

  if (!rubricId) {
    const { data: latestVersion, error: versionError } = await supabase
      .from("scoring_rubrics")
      .select("version_number")
      .eq("cycle_id", cycle.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionError) throw versionError;

    const { data: insertedRubric, error: rubricError } = await supabase
      .from("scoring_rubrics")
      .insert({
        cycle_id: cycle.id,
        name: rubricDefinition.name,
        version_number: (latestVersion?.version_number ?? 0) + 1,
        status: "published",
        score_min: rubricDefinition.score_min,
        score_max: rubricDefinition.score_max,
        source_system: "ghsmta_2025_2026_workbook",
      })
      .select("id")
      .single();
    if (rubricError) throw rubricError;
    rubricId = insertedRubric.id;
  } else if (existingRubric.status !== "published") {
    const { error: publishError } = await supabase
      .from("scoring_rubrics")
      .update({
        name: rubricDefinition.name,
        status: "published",
        score_min: rubricDefinition.score_min,
        score_max: rubricDefinition.score_max,
      })
      .eq("id", rubricId);
    if (publishError) throw publishError;
  }

  const { error: scaleError } = await supabase.from("scoring_scale_levels").upsert(
    rubricDefinition.scale_levels.map((level, index) => ({
      rubric_id: rubricId,
      score: level.score,
      label: level.label,
      description: level.description,
      sort_order: index + 1,
    })),
    { onConflict: "rubric_id,score" },
  );
  if (scaleError) throw scaleError;

  for (const category of rubricDefinition.categories) {
    const { data: savedCategory, error: categoryError } = await supabase
      .from("scoring_categories")
      .upsert(
        {
          rubric_id: rubricId,
          category_key: category.category_key,
          title: category.title,
          description: category.description,
          guidance: category.guidance,
          subject_label: category.subject_label,
          sort_order: category.sort_order,
          required: category.required,
          allow_not_applicable: category.allow_not_applicable,
          active: true,
        },
        { onConflict: "rubric_id,category_key" },
      )
      .select("id")
      .single();
    if (categoryError) throw categoryError;

    const { error: criteriaError } = await supabase.from("scoring_criteria").upsert(
      category.criteria.map((criterion) => ({
        category_id: savedCategory.id,
        criterion_key: criterion.criterion_key,
        title: criterion.title,
        description: criterion.description,
        weight: criterion.weight,
        sort_order: criterion.sort_order,
        active: true,
      })),
      { onConflict: "category_id,criterion_key" },
    );
    if (criteriaError) throw criteriaError;
  }

  console.log(`Seeded ${rubricDefinition.categories.length} categories for ${cycle.season_year} — ${cycle.name}`);
}

console.log("2025-2026 scoring rubric import complete.");
