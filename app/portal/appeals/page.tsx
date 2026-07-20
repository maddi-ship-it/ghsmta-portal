import { AppealWorkspace } from "@/components/appeal-workspace";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppealsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [
    applicationsResult,
    appealsResult,
    categoriesResult,
    rubricsResult,
    filesResult,
    cyclesResult,
  ] = await Promise.all([
      profile.role === "applicant"
        ? supabase
            .from("applications")
            .select("id,school_name,production_title,cycle_id")
            .eq("is_archived", false)
            .order("updated_at", { ascending: false })
        : supabase
            .from("applications")
            .select("id,school_name,production_title,cycle_id")
            .eq("is_archived", false)
            .order("school_name"),
      supabase
        .from("appeals")
        .select("*")
        .order("submitted_at", { ascending: false }),
      supabase
        .from("scoring_categories")
        .select("id,title,rubric_id")
        .eq("active", true)
        .order("sort_order"),
      supabase
        .from("scoring_rubrics")
        .select("id,cycle_id,status,version_number")
        .eq("status", "published")
        .order("version_number", { ascending: false }),
      supabase
        .from("portal_files")
        .select("id,context_id,original_name,generated_name,storage_path,mime_type,file_size,created_at")
        .eq("context_type", "appeal")
        .order("created_at"),
      supabase
        .from("award_cycles")
        .select("id,name,season_year")
        .eq("is_active", true)
        .neq("status", "archived")
        .order("season_year", { ascending: false }),
    ]);

  for (const result of [
    applicationsResult,
    appealsResult,
    categoriesResult,
    rubricsResult,
    filesResult,
    cyclesResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }

  const activeCycleIds = new Set(
    (cyclesResult.data ?? []).map((cycle) => cycle.id),
  );
  const applications = (applicationsResult.data ?? []).filter((application) =>
    activeCycleIds.has(application.cycle_id),
  );
  const activeApplicationIds = new Set(
    applications.map((application) => application.id),
  );
  const appeals = (appealsResult.data ?? []).filter((appeal) =>
    activeApplicationIds.has(appeal.application_id),
  );
  const activeAppealIds = new Set(appeals.map((appeal) => appeal.id));
  const files = (filesResult.data ?? []).filter((file) =>
    activeAppealIds.has(file.context_id),
  );

  const publishedRubricByCycle = new Map<string, string>();
  for (const rubric of rubricsResult.data ?? []) {
    if (!publishedRubricByCycle.has(rubric.cycle_id)) {
      publishedRubricByCycle.set(rubric.cycle_id, rubric.id);
    }
  }

  const rubricCycleMap = new Map(
    [...publishedRubricByCycle.entries()].map(([cycleId, rubricId]) => [
      rubricId,
      cycleId,
    ]),
  );

  const applicationCategories = (categoriesResult.data ?? [])
    .map((category) => ({
      ...category,
      cycle_id: rubricCycleMap.get(category.rubric_id) ?? null,
    }))
    .filter(
      (
        category,
      ): category is typeof category & { cycle_id: string } =>
        Boolean(category.cycle_id),
    );

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Formal review</span>
          <h1>Category Eligibility Appeals</h1>
          <p>
            Submit and review appeals concerning award-category eligibility only. Scores, rankings, and adjudicator narratives are outside this workflow.
          </p>
        </div>
      </div>

      <AppealWorkspace
        appeals={appeals}
        applications={applications}
        categories={applicationCategories}
        cycles={cyclesResult.data ?? []}
        files={files}
        profile={profile}
      />
    </>
  );
}
