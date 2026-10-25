import {
  SchoolFileLibrary,
  type SchoolFileApplication,
  type SchoolFilePronunciationRequirement,
  type SchoolFileRecord,
} from "@/components/school-file-library";
import {
  parseActingCandidateReviewState,
} from "@/lib/acting-candidate-review";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export default async function SchoolFilesPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const admin = createAdminClient();

  let applications: SchoolFileApplication[];

  if (profile.role === "applicant") {
    const { data: applicationData, error: applicationError } = await supabase
      .from("applications")
      .select(
        "id,cycle_id,school_name,production_title,award_cycles(season_year,name)",
      )
      .order("updated_at", { ascending: false });

    if (applicationError) {
      throw new Error(`School file access could not be loaded: ${applicationError.message}`);
    }

    applications = (applicationData ?? []).map((application) => {
      const cycle = Array.isArray(application.award_cycles)
        ? application.award_cycles[0]
        : application.award_cycles;

      return {
        application_id: application.id,
        cycle_id: application.cycle_id,
        school_name: application.school_name,
        production_title: application.production_title,
        season_year: cycle?.season_year ?? "",
        program_name: cycle?.name ?? "School application",
        can_upload: true,
      };
    });
  } else {
    const { data: applicationData, error: applicationError } = await supabase.rpc(
      "get_my_school_file_applications",
    );

    if (applicationError) {
      throw new Error(`School file access could not be loaded: ${applicationError.message}`);
    }

    applications = (applicationData ?? []) as SchoolFileApplication[];
  }

  if (profile.role === "adjudicator" && applications.length > 0) {
    const { data: activeAssignments, error: assignmentError } = await supabase
      .from("adjudicator_assignments")
      .select("application_id")
      .eq("adjudicator_user_id", profile.id)
      .in(
        "application_id",
        applications.map((application) => application.application_id),
      )
      .is("removed_at", null);

    if (assignmentError) {
      throw new Error(
        `School file access could not be verified: ${assignmentError.message}`,
      );
    }

    const activeApplicationIds = new Set(
      (activeAssignments ?? []).map(
        (assignment) => assignment.application_id,
      ),
    );
    applications = applications.filter((application) =>
      activeApplicationIds.has(application.application_id),
    );
  }

  const applicationIds = applications.map((application) => application.application_id);

  let files: SchoolFileRecord[] = [];
  let pronunciationRequirements: SchoolFilePronunciationRequirement[] = [];

  if (applicationIds.length > 0) {
    const [fileResult, candidateReviewResult] = await Promise.all([
      supabase
        .from("portal_files")
        .select(
          "id,application_id,original_name,generated_name,storage_path,mime_type,file_size,uploaded_by,document_category,reviewer_visible,created_at,display_name,person_name,award_category,role_or_character,designer_name,phonetic_spelling,file_notes,production_name",
        )
        .eq("context_type", "application")
        .in("application_id", applicationIds)
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
      admin
        .from("acting_candidate_reviews")
        .select("application_id,state,updated_at")
        .in("application_id", applicationIds),
    ]);
    const { data: fileData, error: fileError } = fileResult;

    if (fileError) {
      throw new Error(`School files could not be loaded: ${fileError.message}`);
    }
    // Pronunciation reminders should never prevent the underlying school-file
    // library from loading if the optional candidate audit lookup is degraded.
    if (candidateReviewResult.error) {
      console.error("Candidate pronunciation requirements could not be loaded", {
        code: candidateReviewResult.error.code,
        message: candidateReviewResult.error.message,
      });
    }

    files = (fileData ?? []) as SchoolFileRecord[];
    const stateByApplication = new Map<string, unknown>();
    for (const row of candidateReviewResult.data ?? []) {
      stateByApplication.set(row.application_id, row.state);
    }
    const normalizeName = (value: string | null | undefined) =>
      value?.trim().toLocaleLowerCase() ?? "";

    pronunciationRequirements = applicationIds.flatMap((applicationId) => {
      const state = parseActingCandidateReviewState(
        stateByApplication.get(applicationId),
      );
      if (
        !state ||
        state.status !== "approved" ||
        !state.pronunciationReuploadRequired ||
        !state.approvedAt
      ) {
        return [];
      }

      const affectedCandidates = state.candidates.filter((candidate) =>
        state.changedSlots.includes(candidate.slot),
      );
      const outstandingNames = affectedCandidates
        .filter(
          (candidate) =>
            !files.some(
              (file) =>
                file.application_id === applicationId &&
                file.document_category === "name_pronunciation" &&
                file.created_at > state.approvedAt! &&
                normalizeName(file.person_name) ===
                  normalizeName(candidate.name),
            ),
        )
        .map((candidate) => candidate.name)
        .filter(Boolean);

      return outstandingNames.length > 0
        ? [
            {
              applicationId,
              approvedAt: state.approvedAt,
              outstandingNames,
            },
          ]
        : [];
    });
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Documents</span>
          <h1>{profile.role === "applicant" ? "Your school files" : "School files"}</h1>
          <p>
            {profile.role === "applicant"
              ? "Upload and view your school’s playbills, Process to Performance materials, virtual audition packets, posters, logos, scenic materials, name pronunciations, headshots, and résumés."
              : "View playbills, Process to Performance materials, virtual audition packets, posters, logos, scenic materials, name pronunciations, headshots, and résumés shared by school teams."}
          </p>
        </div>
      </div>

      <SchoolFileLibrary
        applications={applications}
        initialFiles={files}
        pronunciationRequirements={pronunciationRequirements}
        profile={profile}
      />
    </>
  );
}
