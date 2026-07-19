"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types";

type ReferenceDocument = {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  description: string | null;
  visible_to_applicants: boolean;
  visible_to_adjudicators: boolean;
  visible_to_advisory: boolean;
  created_at: string;
  signed_url?: string;
};

type FolderKey = "all" | "applicant" | "adjudicator" | "advisory";

type Folder = {
  key: FolderKey;
  label: string;
};

const BUCKET = "reference-documents";

function safeFileName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-160);
}

function formatBytes(value: number | null) {
  if (!value || value < 1) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function audienceLabels(document: ReferenceDocument) {
  return [
    document.visible_to_applicants ? "Applicant" : null,
    document.visible_to_adjudicators ? "Adjudicator" : null,
    document.visible_to_advisory ? "Advisory Committee" : null,
  ].filter((value): value is string => Boolean(value));
}

export function ReferenceDocumentLibrary({ role }: { role: AppRole }) {
  const supabase = useMemo(() => createClient(), []);
  const [documents, setDocuments] = useState<ReferenceDocument[]>([]);
  const [activeFolder, setActiveFolder] = useState<FolderKey>(
    role === "owner"
      ? "all"
      : role === "applicant"
        ? "applicant"
        : role === "adjudicator"
          ? "adjudicator"
          : "advisory",
  );
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const folders = useMemo<Folder[]>(() => {
    if (role === "owner") {
      return [
        { key: "all", label: "All documents" },
        { key: "applicant", label: "Applicant" },
        { key: "adjudicator", label: "Adjudicator" },
        { key: "advisory", label: "Advisory Committee" },
      ];
    }

    if (role === "applicant") return [{ key: "applicant", label: "Applicant" }];
    if (role === "adjudicator") return [{ key: "adjudicator", label: "Adjudicator" }];
    return [{ key: "advisory", label: "Advisory Committee" }];
  }, [role]);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("reference_documents")
      .select(
        "id,file_name,storage_path,mime_type,file_size,description,visible_to_applicants,visible_to_adjudicators,visible_to_advisory,created_at",
      )
      .order("created_at", { ascending: false });

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const withUrls = await Promise.all(
      ((data ?? []) as ReferenceDocument[]).map(async (document) => {
        const { data: urlData } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(document.storage_path, 60 * 60);

        return {
          ...document,
          signed_url: urlData?.signedUrl,
        };
      }),
    );

    setDocuments(withUrls);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const visibleDocuments = documents.filter((document) => {
    if (activeFolder === "all") return true;
    if (activeFolder === "applicant") return document.visible_to_applicants;
    if (activeFolder === "adjudicator") return document.visible_to_adjudicators;
    return document.visible_to_advisory;
  });

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    const applicant = formData.get("applicant") === "on";
    const adjudicator = formData.get("adjudicator") === "on";
    const advisory = formData.get("advisory") === "on";
    const description = String(formData.get("description") ?? "").trim();

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file to upload.");
      return;
    }

    if (!applicant && !adjudicator && !advisory) {
      setError("Select at least one audience folder.");
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setError("Files must be 50 MB or smaller.");
      return;
    }

    setUploading(true);

    const fileName = safeFileName(file.name) || "reference-document";
    const storagePath = `${new Date().getFullYear()}/${crypto.randomUUID()}-${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file, {
        cacheControl: "3600",
        contentType: file.type || undefined,
        upsert: false,
      });

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { error: metadataError } = await supabase
      .from("reference_documents")
      .insert({
        file_name: file.name,
        storage_path: storagePath,
        mime_type: file.type || null,
        file_size: file.size,
        description: description || null,
        visible_to_applicants: applicant,
        visible_to_adjudicators: adjudicator,
        visible_to_advisory: advisory,
      });

    if (metadataError) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      setError(metadataError.message);
      setUploading(false);
      return;
    }

    form.reset();
    setMessage("Reference document uploaded.");
    await loadDocuments();
    setUploading(false);
  }

  async function deleteDocument(document: ReferenceDocument) {
    if (!window.confirm(`Delete ${document.file_name}? This cannot be undone.`)) return;

    setError(null);
    setMessage(null);

    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove([document.storage_path]);

    if (storageError) {
      setError(storageError.message);
      return;
    }

    const { error: deleteError } = await supabase
      .from("reference_documents")
      .delete()
      .eq("id", document.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setMessage("Reference document deleted.");
    await loadDocuments();
  }

  return (
    <div className="reference-library-layout">
      {role === "owner" && (
        <section className="panel reference-upload-panel">
          <div className="panel-header">
            <div>
              <h2>Upload reference document</h2>
              <p>Select every audience folder that should receive the file.</p>
            </div>
          </div>
          <div className="panel-body">
            <form className="reference-upload-form" onSubmit={uploadDocument}>
              <div className="field reference-file-field">
                <label htmlFor="reference_file">File</label>
                <input className="input" id="reference_file" name="file" required type="file" />
                <small>Maximum file size: 50 MB.</small>
              </div>

              <div className="field reference-description-field">
                <label htmlFor="reference_description">Description</label>
                <input
                  className="input"
                  id="reference_description"
                  name="description"
                  placeholder="Optional description"
                />
              </div>

              <fieldset className="field reference-audience-field">
                <legend>Audience folders</legend>
                <div className="reference-audience-options">
                  <label><input name="applicant" type="checkbox" /> Applicant</label>
                  <label><input name="adjudicator" type="checkbox" /> Adjudicator</label>
                  <label><input name="advisory" type="checkbox" /> Advisory Committee Member</label>
                </div>
              </fieldset>

              <button className="button button-dark" disabled={uploading} type="submit">
                {uploading ? "Uploading…" : "Upload document"}
              </button>
            </form>
          </div>
        </section>
      )}

      {(message || error) && (
        <div className={error ? "form-error page-message" : "notice page-message"}>
          {error ?? message}
        </div>
      )}

      <section className="panel reference-library-panel">
        <div className="reference-folder-tabs" role="tablist" aria-label="Reference document folders">
          {folders.map((folder) => (
            <button
              aria-selected={activeFolder === folder.key}
              className={activeFolder === folder.key ? "is-active" : ""}
              key={folder.key}
              onClick={() => setActiveFolder(folder.key)}
              role="tab"
              type="button"
            >
              <span aria-hidden="true">▱</span>
              {folder.label}
            </button>
          ))}
        </div>

        <div className="panel-body">
          {loading ? (
            <div className="empty-state compact-empty-state"><p>Loading documents…</p></div>
          ) : visibleDocuments.length === 0 ? (
            <div className="empty-state">
              <h3>No documents in this folder.</h3>
              <p>Files shared with this audience will appear here.</p>
            </div>
          ) : (
            <div className="reference-document-grid">
              {visibleDocuments.map((document) => (
                <article className="reference-document-card" key={document.id}>
                  <div className="reference-document-icon" aria-hidden="true">▤</div>
                  <div className="reference-document-copy">
                    <strong>{document.file_name}</strong>
                    {document.description && <p>{document.description}</p>}
                    <small>{formatBytes(document.file_size)} · Uploaded {formatDate(document.created_at)}</small>
                    {role === "owner" && (
                      <div className="reference-audience-badges">
                        {audienceLabels(document).map((label) => <span className="badge" key={label}>{label}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="reference-document-actions">
                    {document.signed_url ? (
                      <a className="button button-secondary button-compact" href={document.signed_url} rel="noreferrer" target="_blank">
                        Open
                      </a>
                    ) : (
                      <button className="button button-secondary button-compact" disabled type="button">Unavailable</button>
                    )}
                    {role === "owner" && (
                      <button className="text-button danger-text" onClick={() => void deleteDocument(document)} type="button">
                        Delete
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
