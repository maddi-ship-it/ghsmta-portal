"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { archiveSchoolFile } from "@/app/portal/files/actions";
import { uploadPortalFiles } from "@/lib/portal-file-client";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export type SchoolFileApplication = {
  application_id: string;
  cycle_id: string;
  school_name: string;
  production_title: string | null;
  season_year: string;
  program_name: string;
  can_upload: boolean;
};

export type SchoolFileRecord = {
  id: string;
  application_id: string;
  original_name: string;
  generated_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: string;
  document_category: string;
  reviewer_visible: boolean;
  created_at: string;
};

const CATEGORY_OPTIONS = [
  ["production", "Production documents"],
  ["script", "Scripts or excerpts"],
  ["design", "Design materials"],
  ["audition", "Audition materials"],
  ["schedule", "Schedule and venue documents"],
  ["supporting", "Supporting documentation"],
  ["other", "Other"],
] as const;

function formatBytes(value: number | null) {
  if (!value || value < 1) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function categoryLabel(value: string) {
  return CATEGORY_OPTIONS.find(([key]) => key === value)?.[1] ?? "Other";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function SchoolFileLibrary({
  profile,
  applications,
  initialFiles,
}: {
  profile: Profile;
  applications: SchoolFileApplication[];
  initialFiles: SchoolFileRecord[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [selectedApplicationId, setSelectedApplicationId] = useState(
    applications[0]?.application_id ?? "",
  );
  const [category, setCategory] = useState("production");
  const [reviewerVisible, setReviewerVisible] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedApplication = applications.find(
    (application) => application.application_id === selectedApplicationId,
  );

  const visibleFiles = initialFiles.filter((file) => {
    if (selectedApplicationId && file.application_id !== selectedApplicationId) {
      return false;
    }

    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return true;

    return [file.original_name, file.generated_name, file.document_category]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch);
  });

  async function uploadFiles(form: HTMLFormElement) {
    setError(null);
    setStatus(null);

    const application = selectedApplication;
    const files = Array.from(
      (form.elements.namedItem("files") as HTMLInputElement | null)?.files ?? [],
    );

    if (!application) {
      setError("Choose a school application.");
      return;
    }

    if (!application.can_upload) {
      setError("You have view-only access to this school file library.");
      return;
    }

    if (files.length === 0) {
      setError("Choose at least one file.");
      return;
    }

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
          documentType: categoryLabel(category),
          documentCategory: category,
          reviewerVisible,
        });

        form.reset();
        setCategory("production");
        setReviewerVisible(true);
        setStatus(`${files.length} ${files.length === 1 ? "file" : "files"} uploaded.`);
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Upload failed.");
      }
    });
  }

  async function downloadFile(file: SchoolFileRecord) {
    setError(null);
    const { data, error: signedUrlError } = await supabase.storage
      .from("portal-files")
      .createSignedUrl(file.storage_path, 60);

    if (signedUrlError || !data?.signedUrl) {
      setError(signedUrlError?.message ?? "Could not open the file.");
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function removeFile(fileId: string) {
    if (!window.confirm("Remove this file from the active school library?")) {
      return;
    }

    const formData = new FormData();
    formData.set("file_id", fileId);
    setError(null);
    setStatus(null);

    startTransition(async () => {
      try {
        await archiveSchoolFile(formData);
        setStatus("File removed from the active library.");
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not remove the file.");
      }
    });
  }

  if (applications.length === 0) {
    return (
      <section className="panel empty-state">
        <h2>No school files are available.</h2>
        <p>
          Assigned school libraries will appear here once an application or
          adjudication assignment is connected to your account.
        </p>
      </section>
    );
  }

  return (
    <div className="school-files-layout">
      <aside className="panel school-files-sidebar">
        <div className="panel-header">
          <div>
            <span className="eyebrow">School library</span>
            <h2>Applications</h2>
          </div>
        </div>
        <div className="panel-body school-file-application-list">
          {applications.map((application) => (
            <button
              className={
                application.application_id === selectedApplicationId
                  ? "school-file-application active"
                  : "school-file-application"
              }
              key={application.application_id}
              onClick={() => setSelectedApplicationId(application.application_id)}
              type="button"
            >
              <strong>{application.school_name}</strong>
              <span>{application.production_title || application.program_name}</span>
              <small>{application.can_upload ? "Upload + manage" : "Reviewer access"}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="panel school-files-main">
        <div className="panel-header school-files-heading">
          <div>
            <span className="eyebrow">Private school files</span>
            <h2>{selectedApplication?.school_name}</h2>
            <p>
              {selectedApplication?.production_title || selectedApplication?.program_name}
              {selectedApplication ? ` · ${selectedApplication.season_year}` : ""}
            </p>
          </div>
          <span className="badge">{visibleFiles.length} files</span>
        </div>

        <div className="panel-body form-stack">
          {selectedApplication?.can_upload && (
            <form
              className="school-file-upload-form"
              onSubmit={(event) => {
                event.preventDefault();
                void uploadFiles(event.currentTarget);
              }}
            >
              <div className="field">
                <label htmlFor="school-file-category">Category</label>
                <select
                  className="select"
                  id="school-file-category"
                  onChange={(event) => setCategory(event.target.value)}
                  value={category}
                >
                  {CATEGORY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="field school-file-input-field">
                <label htmlFor="school-file-input">Files</label>
                <input className="input" id="school-file-input" multiple name="files" required type="file" />
              </div>
              <label className="checkbox-row school-file-reviewer-toggle">
                <input
                  checked={reviewerVisible}
                  onChange={(event) => setReviewerVisible(event.target.checked)}
                  type="checkbox"
                />
                <span>Visible to assigned adjudicators and Advisory members</span>
              </label>
              <button className="button button-dark" disabled={isPending} type="submit">
                {isPending ? "Uploading…" : "Upload files"}
              </button>
            </form>
          )}

          <div className="school-files-toolbar">
            <div>
              <strong>Active files</strong>
              <small>Up to 50 MB per file</small>
            </div>
            <input
              className="input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search files"
              type="search"
              value={search}
            />
          </div>

          {error && <div className="form-error">{error}</div>}
          {status && <div className="success-banner">{status}</div>}

          {visibleFiles.length === 0 ? (
            <div className="empty-state school-files-empty">
              <h3>No files uploaded yet.</h3>
              <p>School documents and reviewer materials will appear here.</p>
            </div>
          ) : (
            <div className="school-file-list">
              {visibleFiles.map((file) => {
                const canRemove =
                  profile.role === "owner" ||
                  file.uploaded_by === profile.id ||
                  Boolean(selectedApplication?.can_upload);

                return (
                  <article className="school-file-row" key={file.id}>
                    <span className="school-file-icon" aria-hidden="true">▱</span>
                    <div className="school-file-copy">
                      <strong>{file.original_name}</strong>
                      <span>
                        {categoryLabel(file.document_category)} · {formatBytes(file.file_size)} · {formatDate(file.created_at)}
                      </span>
                      <small>
                        {file.reviewer_visible ? "Visible to assigned reviewers" : "School + Owners only"}
                      </small>
                    </div>
                    <div className="school-file-actions">
                      <button className="button button-secondary button-compact" onClick={() => void downloadFile(file)} type="button">
                        Open
                      </button>
                      {canRemove && (
                        <button className="text-button danger-text" disabled={isPending} onClick={() => removeFile(file.id)} type="button">
                          Remove
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
