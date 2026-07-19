import { AppealWorkspace } from "@/components/appeal-workspace";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppealsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [applicationsResult, appealsResult, categoriesResult, filesResult, cyclesResult] =
    await Promise.all([
      profile.role === "applicant"
        ? supabase
            .from("applications")
            .select("id,school_name,production_title,cycle_id")
            .eq("applicant_user_id", profile.id)
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
        .from("portal_files")
        .select("id,context_id,original_name,generated_name,storage_path,mime_type,file_size,created_at")
        .eq("context_type", "appeal")
        .order("created_at"),
      supabase
        .from("award_cycles")
        .select("id,name,season_year")
        .order("season_year", { ascending: false }),
    ]);

  for (const result of [applicationsResult, appealsResult, categoriesResult, filesResult, cyclesResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Formal review</span>
          <h1>Appeals</h1>
          <p>
            Submit supporting information, track review status, and preserve the
            final resolution with a complete audit trail.
          </p>
        </div>
      </div>

      <AppealWorkspace
        appeals={appealsResult.data ?? []}
        applications={applicationsResult.data ?? []}
        categories={categoriesResult.data ?? []}
        cycles={cyclesResult.data ?? []}
        files={filesResult.data ?? []}
        profile={profile}
      />
    </>
  );
}
