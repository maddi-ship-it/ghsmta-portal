import {
  SchoolFileLibrary,
  type SchoolFileApplication,
  type SchoolFileRecord,
} from "@/components/school-file-library";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function SchoolFilesPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: applicationData, error: applicationError } = await supabase.rpc(
    "get_my_school_file_applications",
  );

  if (applicationError) {
    throw new Error(`School file access could not be loaded: ${applicationError.message}`);
  }

  const applications = (applicationData ?? []) as SchoolFileApplication[];
  const applicationIds = applications.map((application) => application.application_id);

  let files: SchoolFileRecord[] = [];

  if (applicationIds.length > 0) {
    const { data: fileData, error: fileError } = await supabase
      .from("portal_files")
      .select(
        "id,application_id,original_name,generated_name,storage_path,mime_type,file_size,uploaded_by,document_category,reviewer_visible,created_at,display_name,person_name,award_category,role_or_character,designer_name,phonetic_spelling,file_notes,production_name",
      )
      .eq("context_type", "application")
      .in("application_id", applicationIds)
      .is("archived_at", null)
      .order("created_at", { ascending: false });

    if (fileError) {
      throw new Error(`School files could not be loaded: ${fileError.message}`);
    }

    files = (fileData ?? []) as SchoolFileRecord[];
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Documents</span>
          <h1>School files</h1>
          <p>
            Upload playbills, logos, scenic materials, name pronunciations, headshots, and résumés for the school team and assigned GHSMTA reviewers.
          </p>
        </div>
      </div>

      <SchoolFileLibrary
        applications={applications}
        initialFiles={files}
        profile={profile}
      />
    </>
  );
}
