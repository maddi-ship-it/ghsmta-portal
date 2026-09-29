"use client";

import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Upload } from "tus-js-client";

import { RegalConfirmDialog } from "@/components/regal-confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import {
  isAllowedPortalFile,
  portalFileMimeType,
  PORTAL_FILE_ACCEPT,
  REFERENCE_DOCUMENT_MAX_FILE_BYTES,
} from "@/lib/file-upload-policy";
import {
  referenceFolderBreadcrumbs,
  referenceFolderCanContainDocument,
  referenceFolderPath,
  referenceItemVisibleToAudience,
  type ReferenceAudience,
  type ReferenceDocumentVisibility,
  type ReferenceFolder,
} from "@/lib/reference-document-folders";
import type { AppRole } from "@/lib/types";

type ReferenceDocument = {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  description: string | null;
  folder_id: string | null;
  visible_to_applicants: boolean;
  visible_to_adjudicators: boolean;
  visible_to_advisory: boolean;
  created_at: string;
  signed_url?: string;
};

type AudienceTab = {
  key: ReferenceAudience;
  label: string;
};

type AudienceSelection = {
  applicant: boolean;
  adjudicator: boolean;
  advisory: boolean;
};

const BUCKET = "reference-documents";
const RESUMABLE_CHUNK_SIZE = 6 * 1024 * 1024;
const DOCUMENT_DRAG_TYPE = "application/x-ghsmta-reference-document";

function resumableStorageEndpoint() {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!projectUrl) {
    throw new Error("Supabase storage is not configured.");
  }

  const url = new URL(projectUrl);
  if (url.hostname.endsWith(".supabase.co")) {
    const projectRef = url.hostname.split(".")[0];
    return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  }

  return new URL("/storage/v1/upload/resumable", url).toString();
}

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

function audienceLabels(document: ReferenceDocumentVisibility) {
  return [
    document.visible_to_applicants ? "Applicant" : null,
    document.visible_to_adjudicators ? "Adjudicator" : null,
    document.visible_to_advisory ? "Advisory Committee" : null,
  ].filter((value): value is string => Boolean(value));
}

export function ReferenceDocumentLibrary({ role }: { role: AppRole }) {
  const supabase = useMemo(() => createClient(), []);
  const [documents, setDocuments] = useState<ReferenceDocument[]>([]);
  const [libraryFolders, setLibraryFolders] = useState<ReferenceFolder[]>([]);
  const [activeAudience, setActiveAudience] = useState<ReferenceAudience>(
    role === "owner"
      ? "all"
      : role === "applicant"
        ? "applicant"
        : role === "adjudicator"
          ? "adjudicator"
          : "advisory",
  );
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [movingDocumentId, setMovingDocumentId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dropZoneActive, setDropZoneActive] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ReferenceDocument | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audienceTabs = useMemo<AudienceTab[]>(() => {
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

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [documentResult, folderResult] = await Promise.all([
      supabase
        .from("reference_documents")
        .select(
          "id,file_name,storage_path,mime_type,file_size,description,folder_id,visible_to_applicants,visible_to_adjudicators,visible_to_advisory,created_at",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("reference_document_folders")
        .select(
          "id,parent_id,name,visible_to_applicants,visible_to_adjudicators,visible_to_advisory,created_at",
        )
        .order("name"),
    ]);

    if (documentResult.error || folderResult.error) {
      setError(
        documentResult.error?.message ??
          folderResult.error?.message ??
          "The reference library could not be loaded.",
      );
      setLoading(false);
      return;
    }

    const withUrls = await Promise.all(
      ((documentResult.data ?? []) as ReferenceDocument[]).map(async (document) => {
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
    setLibraryFolders((folderResult.data ?? []) as ReferenceFolder[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLibrary();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadLibrary]);

  const visibleDocuments = documents.filter((document) => {
    return (
      document.folder_id === currentFolderId &&
      referenceItemVisibleToAudience(document, activeAudience)
    );
  });

  const visibleFolders = libraryFolders.filter(
    (folder) =>
      folder.parent_id === currentFolderId &&
      referenceItemVisibleToAudience(folder, activeAudience),
  );
  const currentFolder = currentFolderId
    ? libraryFolders.find((folder) => folder.id === currentFolderId) ?? null
    : null;
  const breadcrumbs = referenceFolderBreadcrumbs(
    libraryFolders,
    currentFolderId,
  );
  const activeAudienceLabel =
    audienceTabs.find((tab) => tab.key === activeAudience)?.label ??
    "All documents";

  const audienceDefaults = {
    applicant: currentFolder
      ? currentFolder.visible_to_applicants
      : activeAudience === "applicant",
    adjudicator: currentFolder
      ? currentFolder.visible_to_adjudicators
      : activeAudience === "adjudicator",
    advisory: currentFolder
      ? currentFolder.visible_to_advisory
      : activeAudience === "advisory",
  };

  const availableAudiences = {
    applicant: currentFolder?.visible_to_applicants ?? true,
    adjudicator: currentFolder?.visible_to_adjudicators ?? true,
    advisory: currentFolder?.visible_to_advisory ?? true,
  };

  function audiencesForDestination(folderId: string | null): AudienceSelection | null {
    if (folderId) {
      const folder = libraryFolders.find((item) => item.id === folderId);
      if (!folder) return null;
      return {
        applicant: folder.visible_to_applicants,
        adjudicator: folder.visible_to_adjudicators,
        advisory: folder.visible_to_advisory,
      };
    }

    if (activeAudience === "all") return null;
    return {
      applicant: activeAudience === "applicant",
      adjudicator: activeAudience === "adjudicator",
      advisory: activeAudience === "advisory",
    };
  }

  async function uploadReferenceFiles({
    audiences,
    description,
    destinationFolderId,
    files,
  }: {
    audiences: AudienceSelection;
    description: string;
    destinationFolderId: string | null;
    files: File[];
  }) {
    setError(null);
    setMessage(null);

    if (files.length === 0) {
      setError("Choose at least one file to upload.");
      return false;
    }
    if (!audiences.applicant && !audiences.adjudicator && !audiences.advisory) {
      setError("Select at least one audience.");
      return false;
    }

    for (const file of files) {
      if (file.size === 0) {
        setError(`${file.name} is empty.`);
        return false;
      }
      if (file.size > REFERENCE_DOCUMENT_MAX_FILE_BYTES) {
        setError(`${file.name} is larger than 500 MB.`);
        return false;
      }
      if (!isAllowedPortalFile(file) || !portalFileMimeType(file)) {
        setError(`${file.name} is not a supported file type.`);
        return false;
      }
    }

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (sessionError || !accessToken || !publishableKey) {
      setError(
        sessionError?.message ??
          "Your upload session is unavailable. Sign in again and retry.",
      );
      return false;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      for (const [fileIndex, file] of files.entries()) {
        const contentType = portalFileMimeType(file)!;
        const fileName = safeFileName(file.name) || "reference-document";
        let storagePath = `${new Date().getFullYear()}/${crypto.randomUUID()}-${fileName}`;

        await new Promise<void>((resolve, reject) => {
          const upload = new Upload(file, {
            endpoint: resumableStorageEndpoint(),
            retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
            headers: {
              authorization: `Bearer ${accessToken}`,
              apikey: publishableKey,
              "x-upsert": "false",
            },
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            chunkSize: RESUMABLE_CHUNK_SIZE,
            metadata: {
              bucketName: BUCKET,
              objectName: storagePath,
              contentType,
              cacheControl: "3600",
            },
            onProgress: (bytesUploaded, bytesTotal) => {
              const fileProgress = bytesTotal > 0 ? bytesUploaded / bytesTotal : 0;
              setUploadProgress(
                Math.min(
                  100,
                  Math.round(((fileIndex + fileProgress) / files.length) * 100),
                ),
              );
            },
            onError: reject,
            onSuccess: () => resolve(),
          });

          void upload
            .findPreviousUploads()
            .then((previousUploads) => {
              const previousUpload = previousUploads.find(
                (candidate) =>
                  candidate.metadata.bucketName === BUCKET &&
                  Boolean(candidate.metadata.objectName),
              );
              if (previousUpload) {
                storagePath = previousUpload.metadata.objectName;
                upload.resumeFromPreviousUpload(previousUpload);
              }
              upload.start();
            })
            .catch(reject);
        });

        const { error: metadataError } = await supabase
          .from("reference_documents")
          .insert({
            file_name: file.name,
            storage_path: storagePath,
            mime_type: file.type || null,
            file_size: file.size,
            description: description || null,
            folder_id: destinationFolderId,
            visible_to_applicants: audiences.applicant,
            visible_to_adjudicators: audiences.adjudicator,
            visible_to_advisory: audiences.advisory,
          });

        if (metadataError) {
          await supabase.storage.from(BUCKET).remove([storagePath]);
          throw metadataError;
        }
      }

      setUploadProgress(100);
      setMessage(
        files.length === 1
          ? `${files[0].name} uploaded.`
          : `${files.length} files uploaded.`,
      );
      await loadLibrary();
      return true;
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The resumable upload failed.",
      );
      return false;
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const fileList = formData.getAll("file").filter(
      (value): value is File => value instanceof File,
    );
    const didUpload = await uploadReferenceFiles({
      audiences: {
        applicant: formData.get("applicant") === "on",
        adjudicator: formData.get("adjudicator") === "on",
        advisory: formData.get("advisory") === "on",
      },
      description: String(formData.get("description") ?? "").trim(),
      destinationFolderId: currentFolderId,
      files: fileList,
    });

    if (didUpload) form.reset();
  }

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("folder_name") ?? "").trim();
    const applicant = formData.get("folder_applicant") === "on";
    const adjudicator = formData.get("folder_adjudicator") === "on";
    const advisory = formData.get("folder_advisory") === "on";

    if (!name) {
      setError("Enter a folder name.");
      return;
    }
    if (!applicant && !adjudicator && !advisory) {
      setError("Select at least one audience for the folder.");
      return;
    }

    const { error: createError } = await supabase
      .from("reference_document_folders")
      .insert({
        name,
        parent_id: currentFolderId,
        visible_to_applicants: applicant,
        visible_to_adjudicators: adjudicator,
        visible_to_advisory: advisory,
      });

    if (createError) {
      setError(createError.message);
      return;
    }

    form.reset();
    setMessage(`Folder “${name}” created.`);
    await loadLibrary();
  }

  async function moveDocumentToFolder(
    document: ReferenceDocument,
    destinationFolderId: string | null,
  ) {
    if (document.folder_id === destinationFolderId) return;

    setError(null);
    setMessage(null);
    setMovingDocumentId(document.id);

    try {
      const { error: moveError } = await supabase
        .from("reference_documents")
        .update({ folder_id: destinationFolderId })
        .eq("id", document.id);

      if (moveError) {
        setError(moveError.message);
        return;
      }

      setMessage(`${document.file_name} moved.`);
      await loadLibrary();
    } finally {
      setMovingDocumentId(null);
    }
  }

  async function moveDocument(
    document: ReferenceDocument,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const destination = String(formData.get("folder_id") ?? "");
    await moveDocumentToFolder(document, destination || null);
  }

  function beginDocumentDrag(
    document: ReferenceDocument,
    event: DragEvent<HTMLElement>,
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DOCUMENT_DRAG_TYPE, document.id);
    event.dataTransfer.setData("text/plain", document.file_name);
  }

  async function handleLibraryDrop(
    event: DragEvent<HTMLElement>,
    destinationFolderId: string | null,
  ) {
    event.preventDefault();
    setDragOverFolderId(null);
    setDropZoneActive(false);

    const draggedDocumentId = event.dataTransfer.getData(DOCUMENT_DRAG_TYPE);
    if (draggedDocumentId) {
      const document = documents.find((item) => item.id === draggedDocumentId);
      if (document) await moveDocumentToFolder(document, destinationFolderId);
      return;
    }

    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    const audiences = audiencesForDestination(destinationFolderId);
    if (!audiences) {
      setError(
        "Choose an audience tab or open a folder before dropping files here.",
      );
      return;
    }

    await uploadReferenceFiles({
      audiences,
      description: "",
      destinationFolderId,
      files,
    });
  }

  async function deleteDocument(document: ReferenceDocument) {
    setError(null);
    setMessage(null);
    setDeleting(true);

    try {
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

      setPendingDelete(null);
      setMessage("Reference document deleted.");
      await loadLibrary();
    } finally {
      setDeleting(false);
    }
  }

  const folderPaths = new Map(
    libraryFolders.map((folder) => [
      folder.id,
      referenceFolderPath(libraryFolders, folder.id),
    ]),
  );
  const currentLocationLabel = currentFolder
    ? (folderPaths.get(currentFolder.id) ?? currentFolder.name)
    : activeAudienceLabel;

  function setDropEffect(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types).includes(
      DOCUMENT_DRAG_TYPE,
    )
      ? "move"
      : "copy";
  }

  return (
    <div className="reference-library-layout">
      {(message || error) && (
        <div className={error ? "form-error page-message" : "notice page-message"}>
          {error ?? message}
        </div>
      )}

      <section className="panel reference-library-panel">
        <div className="reference-folder-tabs" role="tablist" aria-label="Reference document folders">
          {audienceTabs.map((folder) => (
            <button
              aria-selected={activeAudience === folder.key}
              className={activeAudience === folder.key ? "is-active" : ""}
              key={folder.key}
              onClick={() => {
                setActiveAudience(folder.key);
                setCurrentFolderId(null);
              }}
              role="tab"
              type="button"
            >
              <span aria-hidden="true">▱</span>
              {folder.label}
            </button>
          ))}
        </div>

        <div className="panel-body">
          <div className="reference-library-toolbar">
            <nav aria-label="Folder breadcrumb" className="reference-breadcrumbs">
              <button
                className={dragOverFolderId === "root" ? "is-drop-target" : ""}
                onClick={() => setCurrentFolderId(null)}
                onDragLeave={() => setDragOverFolderId(null)}
                onDragOver={(event) => {
                  if (role !== "owner") return;
                  setDropEffect(event);
                  setDragOverFolderId("root");
                }}
                onDrop={(event) => {
                  if (role === "owner") void handleLibraryDrop(event, null);
                }}
                type="button"
              >
                {activeAudienceLabel}
              </button>
              {breadcrumbs.map((folder) => (
                <span key={folder.id}>
                  <span aria-hidden="true">/</span>
                  <button
                    className={dragOverFolderId === folder.id ? "is-drop-target" : ""}
                    onClick={() => setCurrentFolderId(folder.id)}
                    onDragLeave={() => setDragOverFolderId(null)}
                    onDragOver={(event) => {
                      if (role !== "owner") return;
                      setDropEffect(event);
                      setDragOverFolderId(folder.id);
                    }}
                    onDrop={(event) => {
                      if (role === "owner") void handleLibraryDrop(event, folder.id);
                    }}
                    type="button"
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
            </nav>

            {role === "owner" && (
              <div className="reference-drive-actions">
                <details className="reference-action-drawer reference-upload-drawer">
                  <summary>Upload files</summary>
                  <form
                    className="reference-upload-form reference-drive-upload-form"
                    key={`${activeAudience}-${currentFolderId ?? "root"}`}
                    onSubmit={uploadDocument}
                  >
                    <div className="reference-drawer-heading">
                      <strong>Upload to {currentLocationLabel}</strong>
                      <small>Choose one or more files. Large uploads resume automatically.</small>
                    </div>
                    <div className="field reference-file-field">
                      <label htmlFor="reference_file">Files</label>
                      <input accept={PORTAL_FILE_ACCEPT} className="input" id="reference_file" multiple name="file" required type="file" />
                      <small>Maximum 500 MB per file.</small>
                    </div>
                    <div className="field reference-description-field">
                      <label htmlFor="reference_description">Description</label>
                      <input className="input" id="reference_description" name="description" placeholder="Optional description for this upload" />
                    </div>
                    <fieldset className="field reference-audience-field">
                      <legend>Audience access</legend>
                      <div className="reference-audience-options">
                        {availableAudiences.applicant && (
                          <label><input defaultChecked={audienceDefaults.applicant} name="applicant" type="checkbox" /> Applicant</label>
                        )}
                        {availableAudiences.adjudicator && (
                          <label><input defaultChecked={audienceDefaults.adjudicator} name="adjudicator" type="checkbox" /> Adjudicator</label>
                        )}
                        {availableAudiences.advisory && (
                          <label><input defaultChecked={audienceDefaults.advisory} name="advisory" type="checkbox" /> Advisory Committee</label>
                        )}
                      </div>
                    </fieldset>
                    <button className="button button-dark button-compact" disabled={uploading} type="submit">
                      {uploading ? `Uploading ${uploadProgress ?? 0}%…` : "Upload files"}
                    </button>
                    {uploading && (
                      <div className="reference-upload-progress" role="status" aria-live="polite">
                        <progress max="100" value={uploadProgress ?? 0} />
                        <span>{uploadProgress ?? 0}% uploaded</span>
                      </div>
                    )}
                  </form>
                </details>

                <details className="reference-action-drawer reference-folder-create">
                  <summary>New folder</summary>
                  <form className="reference-folder-create-form" key={`folder-${activeAudience}-${currentFolderId ?? "root"}`} onSubmit={createFolder}>
                    <div className="field">
                      <label htmlFor="reference_folder_name">Folder name</label>
                      <input className="input" id="reference_folder_name" maxLength={120} name="folder_name" required />
                    </div>
                    <fieldset className="field reference-audience-field">
                      <legend>Audience access</legend>
                      <div className="reference-audience-options">
                        {availableAudiences.applicant && (
                          <label><input defaultChecked={audienceDefaults.applicant} name="folder_applicant" type="checkbox" /> Applicant</label>
                        )}
                        {availableAudiences.adjudicator && (
                          <label><input defaultChecked={audienceDefaults.adjudicator} name="folder_adjudicator" type="checkbox" /> Adjudicator</label>
                        )}
                        {availableAudiences.advisory && (
                          <label><input defaultChecked={audienceDefaults.advisory} name="folder_advisory" type="checkbox" /> Advisory Committee</label>
                        )}
                      </div>
                    </fieldset>
                    <button className="button button-dark button-compact" type="submit">Create folder</button>
                  </form>
                </details>
              </div>
            )}
          </div>

          {role === "owner" && (
            <div
              className={`reference-drop-zone ${dropZoneActive ? "is-active" : ""}`}
              onDragEnter={(event) => {
                setDropEffect(event);
                setDropZoneActive(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropZoneActive(false);
              }}
              onDragOver={(event) => {
                setDropEffect(event);
                setDropZoneActive(true);
              }}
              onDrop={(event) => void handleLibraryDrop(event, currentFolderId)}
            >
              <span aria-hidden="true">⇧</span>
              <div>
                <strong>Drop files here</strong>
                <small>Upload to {currentLocationLabel}, or drag an existing document here to move it.</small>
              </div>
            </div>
          )}

          {loading ? (
            <div className="empty-state compact-empty-state"><p>Loading documents…</p></div>
          ) : visibleDocuments.length === 0 && visibleFolders.length === 0 ? (
            <div className="empty-state">
              <h3>This folder is empty.</h3>
              <p>Folders and files shared with this audience will appear here.</p>
            </div>
          ) : (
            <div className="reference-library-contents">
              {visibleFolders.length > 0 && (
                <div className="reference-subfolder-grid">
                  {visibleFolders.map((folder) => (
                    <button
                      className={`reference-subfolder-card ${dragOverFolderId === folder.id ? "is-drop-target" : ""}`}
                      key={folder.id}
                      onClick={() => setCurrentFolderId(folder.id)}
                      onDragLeave={() => setDragOverFolderId(null)}
                      onDragOver={(event) => {
                        if (role !== "owner") return;
                        setDropEffect(event);
                        setDragOverFolderId(folder.id);
                      }}
                      onDrop={(event) => {
                        if (role === "owner") void handleLibraryDrop(event, folder.id);
                      }}
                      type="button"
                    >
                      <span aria-hidden="true">▰</span>
                      <span>
                        <strong>{folder.name}</strong>
                        <small>{audienceLabels(folder).join(" · ")}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {visibleDocuments.length > 0 && (
                <div className="reference-document-grid">
                  {visibleDocuments.map((document) => (
                <article
                  className={`reference-document-card ${movingDocumentId === document.id ? "is-moving" : ""}`}
                  draggable={role === "owner"}
                  key={document.id}
                  onDragEnd={() => {
                    setDragOverFolderId(null);
                    setDropZoneActive(false);
                  }}
                  onDragStart={(event) => beginDocumentDrag(document, event)}
                  title={role === "owner" ? "Drag this document onto a folder to move it" : undefined}
                >
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
                      <details className="reference-document-menu">
                        <summary aria-label={`Actions for ${document.file_name}`}>•••</summary>
                        <div>
                        <form className="reference-document-move" onSubmit={(event) => void moveDocument(document, event)}>
                          <label htmlFor={`document_folder_${document.id}`}>Move to</label>
                          <select className="select input-compact" defaultValue={document.folder_id ?? ""} id={`document_folder_${document.id}`} name="folder_id">
                            <option value="">Library root</option>
                            {libraryFolders
                              .filter((folder) => referenceFolderCanContainDocument(folder, document))
                              .map((folder) => (
                                <option key={folder.id} value={folder.id}>
                                  {folderPaths.get(folder.id) ?? folder.name}
                                </option>
                              ))}
                          </select>
                          <button className="button button-secondary button-compact" disabled={movingDocumentId === document.id} type="submit">
                            {movingDocumentId === document.id ? "Moving…" : "Move"}
                          </button>
                        </form>
                        <button className="text-button danger-text" onClick={() => setPendingDelete(document)} type="button">
                          Delete document
                        </button>
                        </div>
                      </details>
                    )}
                  </div>
                </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
      <RegalConfirmDialog
        confirmLabel="Delete document"
        description={pendingDelete ? `${pendingDelete.file_name} will be permanently removed from every audience folder.` : "The document will be permanently removed."}
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void deleteDocument(pendingDelete);
        }}
        open={Boolean(pendingDelete)}
        pending={deleting}
        title="Delete this reference document?"
      />
    </div>
  );
}
