import { ReferenceDocumentLibrary } from "@/components/reference-document-library";
import { requireProfile } from "@/lib/auth";

export default async function ReferenceDocumentsPage() {
  const profile = await requireProfile();

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Shared library</span>
          <h1>REFERENCE DOCUMENTS</h1>
          <p>
            Browse audience-specific folders and files. You will only see
            content shared with your portal role.
          </p>
        </div>
      </div>

      <ReferenceDocumentLibrary role={profile.role} />
    </>
  );
}
