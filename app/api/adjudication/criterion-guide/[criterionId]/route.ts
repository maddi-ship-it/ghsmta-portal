import { NextResponse } from "next/server";

import {
  getScoringCriterionGuide,
  SCORING_CRITERION_GUIDE_SEASON,
  SCORING_CRITERION_GUIDE_SOURCE,
} from "@/lib/scoring-criterion-guides";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAFF_ROLES = new Set(["adjudicator", "advisory_member", "owner"]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ criterionId: string }> },
) {
  const { criterionId } = await context.params;
  if (!UUID_PATTERN.test(criterionId)) {
    return NextResponse.json({ error: "Invalid criterion." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: "The scoring guide could not be loaded." },
      { status: 500 },
    );
  }
  if (!profile?.active || !STAFF_ROLES.has(profile.role)) {
    return NextResponse.json(
      { error: "You do not have access to this scoring guide." },
      { status: 403 },
    );
  }

  const { data: criterion, error: criterionError } = await supabase
    .from("scoring_criteria")
    .select("category_id,sort_order,title")
    .eq("id", criterionId)
    .eq("active", true)
    .maybeSingle();

  if (criterionError) {
    return NextResponse.json(
      { error: "The scoring guide could not be loaded." },
      { status: 500 },
    );
  }
  if (!criterion) {
    return NextResponse.json(
      { error: "Scoring guidance was not found for this criterion." },
      { status: 404 },
    );
  }

  const { data: category, error: categoryError } = await supabase
    .from("scoring_categories")
    .select("category_key,rubric_id")
    .eq("id", criterion.category_id)
    .eq("active", true)
    .maybeSingle();

  if (categoryError || !category) {
    return NextResponse.json(
      { error: "Scoring guidance was not found for this criterion." },
      { status: categoryError ? 500 : 404 },
    );
  }

  const { data: rubric, error: rubricError } = await supabase
    .from("scoring_rubrics")
    .select("cycle_id")
    .eq("id", category.rubric_id)
    .maybeSingle();

  if (rubricError || !rubric) {
    return NextResponse.json(
      { error: "Scoring guidance was not found for this criterion." },
      { status: rubricError ? 500 : 404 },
    );
  }

  const { data: cycle, error: cycleError } = await supabase
    .from("award_cycles")
    .select("season_year")
    .eq("id", rubric.cycle_id)
    .maybeSingle();

  if (cycleError || cycle?.season_year !== SCORING_CRITERION_GUIDE_SEASON) {
    return NextResponse.json(
      { error: "Scoring guidance was not found for this rubric version." },
      { status: cycleError ? 500 : 404 },
    );
  }

  const guide = getScoringCriterionGuide(
    category.category_key,
    Number(criterion.sort_order),
  );

  if (!guide || guide.title !== criterion.title) {
    return NextResponse.json(
      { error: "Scoring guidance was not found for this criterion." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      guide,
      sourceDocument: SCORING_CRITERION_GUIDE_SOURCE,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=3600",
      },
    },
  );
}
