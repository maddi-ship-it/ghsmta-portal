import { AdjudicationSandbox } from "@/components/adjudication-sandbox";
import { requireProfile } from "@/lib/auth";
import { loadAdjudicationReferenceLinks } from "@/lib/adjudication-reference-documents";
import { createClient } from "@/lib/supabase/server";
import type {
  AwardCycle,
  ScoringCategory,
  ScoringCriterion,
  ScoringRubric,
  ScoringScaleLevel,
} from "@/lib/types";

export default async function AdjudicationSandboxPage() {
  const profile = await requireProfile([
    "adjudicator",
    "advisory_member",
    "owner",
  ]);
  const supabase = await createClient();
  const referenceLinksPromise = loadAdjudicationReferenceLinks(supabase);
  const { data: rubricData, error: rubricError } = await supabase
    .from("scoring_rubrics")
    .select("*")
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (rubricError) throw new Error(rubricError.message);

  const rubric = rubricData as ScoringRubric | null;

  if (!rubric) {
    return (
      <>
        <div className="page-heading">
          <div>
            <span className="eyebrow">Resources · Practice workspace</span>
            <h1>ADJUDICATION SANDBOX</h1>
            <p>Practice without changing any live school information.</p>
          </div>
        </div>
        <section className="panel empty-state">
          <h2>No published scoring rubric is available.</h2>
          <p>
            The sandbox will open automatically after the current rubric is
            published.
          </p>
        </section>
      </>
    );
  }

  const [categoriesResult, scaleResult, cycleResult] = await Promise.all([
    supabase
      .from("scoring_categories")
      .select("*")
      .eq("rubric_id", rubric.id)
      .eq("active", true)
      .order("sort_order"),
    supabase
      .from("scoring_scale_levels")
      .select("*")
      .eq("rubric_id", rubric.id)
      .order("score", { ascending: false }),
    supabase
      .from("award_cycles")
      .select("*")
      .eq("id", rubric.cycle_id)
      .maybeSingle(),
  ]);

  for (const result of [categoriesResult, scaleResult, cycleResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const categories = (categoriesResult.data ?? []) as ScoringCategory[];
  const categoryIds = categories.map((category) => category.id);
  const criteriaResult = categoryIds.length
    ? await supabase
        .from("scoring_criteria")
        .select("*")
        .in("category_id", categoryIds)
        .eq("active", true)
        .order("sort_order")
    : { data: [], error: null };

  if (criteriaResult.error) throw new Error(criteriaResult.error.message);
  const referenceLinks = await referenceLinksPromise;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {(cycleResult.data as AwardCycle | null)?.season_year ?? "Current cycle"}
            {" · Practice adjudication"}
          </span>
          <h1>GHSMTA PRACTICE SCHOOL</h1>
          <p>Sandbox Musical</p>
        </div>
        <div className="heading-actions">
          <span className="badge">Practice only</span>
        </div>
      </div>

      <AdjudicationSandbox
        categories={categories}
        criteria={(criteriaResult.data ?? []) as ScoringCriterion[]}
        cycle={(cycleResult.data as AwardCycle | null) ?? null}
        links={referenceLinks}
        role={profile.role}
        rubric={rubric}
        scale={(scaleResult.data ?? []) as ScoringScaleLevel[]}
      />
    </>
  );
}
