"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { archiveSchoolFile } from "@/app/portal/files/actions";
import { RegalConfirmDialog } from "@/components/regal-confirm-dialog";
import { uploadPortalFiles } from "@/lib/portal-file-client";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export type SchoolFileApplication = { application_id: string; cycle_id: string; school_name: string; production_title: string | null; season_year: string; program_name: string; can_upload: boolean };
export type SchoolFileRecord = { id: string; application_id: string; original_name: string; generated_name: string; storage_path: string; mime_type: string | null; file_size: number | null; uploaded_by: string; document_category: string; reviewer_visible: boolean; created_at: string; display_name?: string | null; person_name?: string | null; award_category?: string | null; role_or_character?: string | null; designer_name?: string | null; phonetic_spelling?: string | null; file_notes?: string | null; production_name?: string | null };

const FILE_TYPES = [
  ["playbill", "Playbill", ".pdf"],
  ["logo", "Logo", "image/*,.pdf,.svg,.eps"],
  ["scenic", "Scenic Drawings / Renderings", "image/*,.pdf"],
  ["name_pronunciation", "Name Pronunciation", "audio/*,video/*"],
  ["headshot", "Headshot", "image/*"],
  ["resume", "Resume", ".pdf"],
] as const;

function labelFor(value: string) { return FILE_TYPES.find(([key]) => key === value)?.[1] ?? value; }
function formatBytes(value: number | null) { if (!value) return "—"; if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB`; }

export function SchoolFileLibrary({ profile, applications, initialFiles }: { profile: Profile; applications: SchoolFileApplication[]; initialFiles: SchoolFileRecord[] }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [applicationId, setApplicationId] = useState(applications[0]?.application_id ?? "");
  const [fileType, setFileType] = useState("playbill");
  const [reviewerVisible, setReviewerVisible] = useState(true);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  const application = applications.find((item) => item.application_id === applicationId);
  const selectedType = FILE_TYPES.find(([key]) => key === fileType) ?? FILE_TYPES[0];
  const personFields = ["name_pronunciation", "headshot", "resume"].includes(fileType);

  const visibleFiles = initialFiles.filter((file) => file.application_id === applicationId && [file.original_name, file.generated_name, file.person_name, file.award_category, file.document_category].join(" ").toLowerCase().includes(search.trim().toLowerCase()));

  function upload(form: HTMLFormElement) {
    const formData = new FormData(form);
    const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (!application || !application.can_upload || files.length === 0) { setError("Choose an application and at least one file."); return; }
    const personName = String(formData.get("person_name") ?? "").trim();
    const awardCategory = String(formData.get("award_category") ?? "").trim();
    if (personFields && (!personName || !awardCategory)) { setError("Enter the person’s name and award category."); return; }
    setError(null); setMessage(null);
    startTransition(async () => {
      try {
        await uploadPortalFiles({
          files,
          contextType: "application",
          contextId: application.application_id,
          applicationId: application.application_id,
          userId: profile.id,
          season: application.season_year,
          program: application.program_name,
          school: application.school_name,
          documentType: selectedType[1],
          documentCategory: fileType,
          reviewerVisible,
          metadata: {
            displayName: String(formData.get("display_name") ?? "").trim() || null,
            personName: personName || null,
            awardCategory: awardCategory || null,
            roleOrCharacter: String(formData.get("role_or_character") ?? "").trim() || null,
            designerName: String(formData.get("designer_name") ?? "").trim() || null,
            phoneticSpelling: String(formData.get("phonetic_spelling") ?? "").trim() || null,
            fileNotes: String(formData.get("file_notes") ?? "").trim() || null,
            productionName: application.production_title,
          },
        });
        form.reset(); setMessage(`${files.length} file${files.length === 1 ? "" : "s"} uploaded.`); router.refresh();
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Upload failed."); }
    });
  }

  async function openFile(file: SchoolFileRecord) {
    const { data, error: signedError } = await supabase.storage.from("portal-files").createSignedUrl(file.storage_path, 3600);
    if (signedError || !data?.signedUrl) { setError(signedError?.message ?? "Could not open file."); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function confirmRemoval() {
    if (!pendingRemovalId) return;

    const data = new FormData();
    data.set("file_id", pendingRemovalId);

    startTransition(async () => {
      try {
        await archiveSchoolFile(data);
        setPendingRemovalId(null);
        setMessage("File removed from the active school library.");
        router.refresh();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not remove file.",
        );
      }
    });
  }

  if (applications.length === 0) return <section className="panel empty-state"><h2>No school files are available.</h2></section>;

  return (
    <div className="school-files-layout">
      <aside className="panel school-files-sidebar"><div className="panel-header"><div><p className="eyebrow">School library</p><h2>Applications</h2></div></div><div className="panel-body school-file-application-list">{applications.map((item) => <button className={item.application_id === applicationId ? "school-file-application active" : "school-file-application"} key={item.application_id} onClick={() => setApplicationId(item.application_id)} type="button"><strong>{item.school_name}</strong><span>{item.production_title || item.program_name}</span><small>{item.can_upload ? "Upload + manage" : "Reviewer access"}</small></button>)}</div></aside>
      <section className="panel school-files-main"><div className="panel-header"><div><p className="eyebrow">Private school materials</p><h2>{application?.school_name}</h2><p>{application?.production_title}</p></div><span className="badge">{visibleFiles.length} files</span></div><div className="panel-body form-stack">
        {application?.can_upload && <form className="typed-file-upload" onSubmit={(event) => { event.preventDefault(); upload(event.currentTarget); }}>
          <div className="form-grid two-column-form"><div className="field"><label htmlFor="school_file_type">File type</label><select className="select" id="school_file_type" value={fileType} onChange={(event) => setFileType(event.target.value)}>{FILE_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><div className="field"><label htmlFor="school_file_input">Choose file</label><input className="input file-input" id="school_file_input" name="files" type="file" accept={selectedType[2]} multiple={fileType === "scenic"} required /></div></div>
          {fileType === "logo" && <div className="field"><label>Display name</label><input className="input" name="display_name" placeholder="Official school or production logo" /></div>}
          {fileType === "scenic" && <div className="form-grid two-column-form"><div className="field"><label>Drawing / rendering title</label><input className="input" name="display_name" required /></div><div className="field"><label>Scenic designer</label><input className="input" name="designer_name" /></div></div>}
          {personFields && <div className="form-grid two-column-form"><div className="field"><label>Name of person</label><input className="input" name="person_name" required /></div><div className="field"><label>Award category</label><input className="input" name="award_category" required placeholder="Example: Leading Performer" /></div></div>}
          {["headshot", "resume"].includes(fileType) && <div className="field"><label>Role / character <span>Optional</span></label><input className="input" name="role_or_character" /></div>}
          {fileType === "name_pronunciation" && <div className="field"><label>Phonetic spelling <span>Optional</span></label><input className="input" name="phonetic_spelling" placeholder="Example: muh-RYE-uh" /></div>}
          <div className="field"><label>Notes <span>Optional</span></label><textarea className="textarea" name="file_notes" rows={3} /></div>
          <label className="checkbox-row"><input type="checkbox" checked={reviewerVisible} onChange={(event) => setReviewerVisible(event.target.checked)} /><span>Visible to assigned adjudicators and Advisory Committee members</span></label>
          <button className="button button-gold" type="submit" disabled={pending}>{pending ? "Uploading…" : `Upload ${selectedType[1]}`}</button>
        </form>}
        {error && <div className="form-error">{error}</div>}{message && <div className="notice-banner success-banner">{message}</div>}
        <div className="school-files-toolbar"><div><strong>Active files</strong><small>Up to 50 MB each</small></div><input className="input" type="search" placeholder="Search by file, person, or category" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <div className="school-file-list">{visibleFiles.map((file) => <article className="school-file-row" key={file.id}><span className="school-file-icon">▱</span><div className="school-file-copy"><strong>{file.display_name || file.person_name || file.original_name}</strong><span>{labelFor(file.document_category)}{file.award_category ? ` · ${file.award_category}` : ""}{file.person_name ? ` · ${file.person_name}` : ""}</span><small>{formatBytes(file.file_size)} · {file.reviewer_visible ? "Assigned reviewers can access" : "School + Owners only"}</small></div><div className="school-file-actions"><button className="button button-secondary button-compact" type="button" onClick={() => void openFile(file)}>Open</button>{(profile.role === "owner" || application?.can_upload) && <button className="text-button danger-text" type="button" onClick={() => setPendingRemovalId(file.id)}>Remove</button>}</div></article>)}</div>
      </div></section>

      <RegalConfirmDialog
        confirmLabel="Remove file"
        description="The file will be removed from the active school library but retained in the portal archive and audit history."
        destructive
        onCancel={() => setPendingRemovalId(null)}
        onConfirm={confirmRemoval}
        open={Boolean(pendingRemovalId)}
        pending={pending}
        title="Remove this file?"
      />
    </div>
  );
}