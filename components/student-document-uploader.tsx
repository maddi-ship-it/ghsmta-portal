"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { uploadPortalFiles } from "@/lib/portal-file-client";

export function StudentDocumentUploader({
  studentId,
  contextId,
  contextType = "student_profile",
  documentType,
  documentCategory,
  label,
  accept,
}: {
  studentId: string;
  contextId: string;
  contextType?: "student_profile" | "student_submission";
  documentType: string;
  documentCategory?: string;
  label: string;
  accept?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function upload() {
    const files = Array.from(inputRef.current?.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      await uploadPortalFiles({
        files,
        contextType,
        contextId,
        userId: studentId,
        program: "Student Portal",
        documentType,
        documentCategory: documentCategory ?? documentType.toLowerCase().replaceAll(" ", "_"),
        reviewerVisible: true,
      });
      setMessage("Uploaded successfully.");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="student-upload-control">
      <label>{label}</label>
      <div className="student-upload-row">
        <input className="input" ref={inputRef} type="file" accept={accept} />
        <button className="button button-secondary button-compact" disabled={busy} onClick={upload} type="button">
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
