import { AppealWorkspace } from "@/components/appeal-workspace";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppealsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [
    applicationsResult,
    formVersionsResult,
    appealsResult,
    scholarshipRequestsResult,
    categoriesResult,
    filesResult,
    scholarshipFilesResult,
    cyclesResult,
  ] = await Promise.all([
      profile.role === "applicant"
        ? supabase
            .from("applications")
            .select("id,school_name,production_title,cycle_id,form_version_id")
            .eq("is_archived", false)
            .order("updated_at", { ascending: false })
        : supabase
            .from("applications")
            .select("id,school_name,production_title,cycle_id,form_version_id")
            .eq("is_archived", false)
            .order("school_name"),
      supabase
        .from("application_form_versions")
        .select("id,scoring_rubric_id"),
      supabase
        .from("appeals")
        .select("*")
        .order("submitted_at", { ascending: false }),
      supabase
        .from("scholarship_requests")
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
        .from("portal_files")
        .select("id,context_id,original_name,generated_name,storage_path,mime_type,file_size,created_at")
        .eq("context_type", "scholarship_request")
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
    formVersionsResult,
    appealsResult,
    scholarshipRequestsResult,
    categoriesResult,
    filesResult,
    scholarshipFilesResult,
    cyclesResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }

  const activeCycleIds = new Set(
    (cyclesResult.data ?? []).map((cycle) => cycle.id),
  );
  const formRubricMap = new Map(
    (formVersionsResult.data ?? []).map((formVersion) => [
      formVersion.id,
      formVersion.scoring_rubric_id,
    ]),
  );
  const applications = (applicationsResult.data ?? [])
    .filter((application) => activeCycleIds.has(application.cycle_id))
    .map((application) => ({
      ...application,
      scoring_rubric_id: application.form_version_id
        ? formRubricMap.get(application.form_version_id) ?? null
        : null,
    }));
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
  const scholarshipRequests = (scholarshipRequestsResult.data ?? []).filter((request) =>
    activeApplicationIds.has(request.application_id),
  );
  const activeScholarshipRequestIds = new Set(
    scholarshipRequests.map((request) => request.id),
  );
  const scholarshipFiles = (scholarshipFilesResult.data ?? []).filter((file) =>
    activeScholarshipRequestIds.has(file.context_id),
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Formal review</span>
          <h1>School Requests</h1>
          <p>
            Submit eligibility appeals and scholarship support requests. Scholarship requests notify Owners only.
          </p>
        </div>
      </div>

      <AppealWorkspace
        appeals={appeals}
        applications={applications}
        categories={categoriesResult.data ?? []}
        cycles={cyclesResult.data ?? []}
        files={files}
        profile={profile}
        scholarshipFiles={scholarshipFiles}
        scholarshipRequests={scholarshipRequests}
      />
    </>
  );
}
