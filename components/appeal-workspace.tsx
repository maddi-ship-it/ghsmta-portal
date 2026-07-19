"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { uploadPortalFiles } from "@/lib/portal-file-client";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

type Appeal = {
  id: string;
  application_id: string;
  category_id: string | null;
  appeal_type: string;
  explanation: string;
  status: string;
  advisory_notes: string | null;
  owner_notes: string | null;
  resolution: string | null;
  submitted_at: string;
  resolved_at: string | null;
};

type ApplicationOption = {
  id: string;
  school_name: string;
  production_title: string | null;
  cycle_id: string;
};

type CategoryOption = { id: string; title: string; rubric_id: string };
type CycleOption = { id: string; name: string; season_year: string };
type PortalFile = {
  id: string;
  context_id: string;
  original_name: string;
  generated_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
};

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AppealWorkspace({
  profile,
  applications,
  appeals,
  categories,
  cycles,
  files,
}: {
  profile: Profile;
  applications: ApplicationOption[];
  appeals: Appeal[];
  categories: CategoryOption[];
  cycles: CycleOption[];
  files: PortalFile[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openAppeal, setOpenAppeal] = useState<string | null>(appeals[0]?.id ?? null);

  const applicationMap = new Map(applications.map((application) => [application.id, application]));
  const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const categoryMap = new Map(categories.map((category) => [category.id, category.title]));

  async function submitAppeal(formData: FormData) {
    setCreating(true);
    setMessage(null);
    setError(null);

    try {
      const applicationId = String(formData.get("application_id") ?? "");
      const categoryId = String(formData.get("category_id") ?? "") || null;
      const explanation = String(formData.get("explanation") ?? "").trim();
      const selectedApplication = applicationMap.get(applicationId);
      if (!selectedApplication || explanation.length < 10) {
        throw new Error("Choose an application and enter a complete explanation.");
      }

      const { data: appeal, error: appealError } = await supabase
        .from("appeals")
        .insert({
          application_id: applicationId,
          submitted_by: profile.id,
          category_id: categoryId,
          appeal_type: String(formData.get("appeal_type") ?? "adjudication"),
          explanation,
          status: "submitted",
        })
        .select("id")
        .single();

      if (appealError || !appeal) throw new Error(appealError?.message ?? "Could not create appeal.");

      const selectedFiles = formData
        .getAll("files")
        .filter((value): value is File => value instanceof File && value.size > 0);
      if (selectedFiles.length > 0) {
        const cycle = cycleMap.get(selectedApplication.cycle_id);
        await uploadPortalFiles({
          files: selectedFiles,
          contextType: "appeal",
          contextId: appeal.id as string,
          applicationId,
          userId: profile.id,
          season: cycle?.season_year,
          program: cycle?.name,
          school: selectedApplication.school_name,
          documentType: "Appeal-Supporting-Document",
        });
      }

      setMessage("Appeal submitted. Owners and the Advisory Committee have been notified.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not submit appeal.");
    } finally {
      setCreating(false);
    }
  }

  async function updateAppeal(appealId: string, formData: FormData) {
    setMessage(null);
    setError(null);
    const updates: Record<string, unknown> = {
      status: String(formData.get("status") ?? "submitted"),
    };

    if (profile.role === "advisory_member" || profile.role === "owner") {
      updates.advisory_notes = String(formData.get("advisory_notes") ?? "").trim() || null;
    }
    if (profile.role === "owner") {
      updates.owner_notes = String(formData.get("owner_notes") ?? "").trim() || null;
      updates.resolution = String(formData.get("resolution") ?? "").trim() || null;
      if (["resolved", "denied"].includes(String(updates.status))) {
        updates.resolved_by = profile.id;
        updates.resolved_at = new Date().toISOString();
      }
    }

    const { error: updateError } = await supabase.from("appeals").update(updates).eq("id", appealId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage("Appeal updated.");
    router.refresh();
  }

  async function openFile(file: PortalFile) {
    const { data, error: signedError } = await supabase.storage
      .from("portal-files")
      .createSignedUrl(file.storage_path, 60 * 60);
    if (signedError || !data?.signedUrl) {
      setError(signedError?.message ?? "Could not open file.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="appeal-workspace">
      {profile.role === "applicant" && (
        <section className="panel appeal-submit-panel">
          <div className="panel-header"><div><h2>Submit an appeal</h2><p>Supporting files are automatically renamed and preserved with the appeal.</p></div></div>
          <div className="panel-body">
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void submitAppeal(new FormData(event.currentTarget));
              }}
            >
              <div className="form-grid two-column-form">
                <div className="field"><label htmlFor="appeal_application">Application</label><select className="select" id="appeal_application" name="application_id" required><option value="">Select application</option>{applications.map((application) => <option key={application.id} value={application.id}>{application.school_name} — {application.production_title ?? "Untitled production"}</option>)}</select></div>
                <div className="field"><label htmlFor="appeal_type">Appeal type</label><select className="select" id="appeal_type" name="appeal_type"><option value="adjudication">Adjudication decision</option><option value="eligibility">Eligibility decision</option><option value="administrative">Administrative decision</option><option value="other">Other</option></select></div>
              </div>
              <div className="field"><label htmlFor="appeal_category">Category</label><select className="select" id="appeal_category" name="category_id"><option value="">General / not category-specific</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}</select></div>
              <div className="field"><label htmlFor="appeal_explanation">Explanation</label><textarea className="textarea" id="appeal_explanation" name="explanation" required rows={7} placeholder="Explain the decision being appealed and the requested resolution." /></div>
              <div className="field"><label htmlFor="appeal_files">Supporting files</label><input className="input" id="appeal_files" multiple name="files" type="file" /><small>Up to 50 MB per file. Files receive a standardized season/program/school name.</small></div>
              <button className="button button-dark" disabled={creating} type="submit">{creating ? "Submitting…" : "Submit appeal"}</button>
            </form>
          </div>
        </section>
      )}

      {(message || error) && <div className={error ? "form-error page-message" : "notice page-message"}>{error ?? message}</div>}

      <section className="panel">
        <div className="panel-header"><div><h2>{profile.role === "applicant" ? "My appeals" : "Appeal review queue"}</h2><p>{appeals.length} appeal{appeals.length === 1 ? "" : "s"}</p></div></div>
        <div className="appeal-list">
          {appeals.length === 0 ? <div className="empty-state"><h3>No appeals</h3><p>Appeals will appear here after submission.</p></div> : appeals.map((appeal) => {
            const application = applicationMap.get(appeal.application_id);
            const appealFiles = files.filter((file) => file.context_id === appeal.id);
            const expanded = openAppeal === appeal.id;
            return (
              <article className="appeal-card" key={appeal.id}>
                <button className="appeal-card-summary" onClick={() => setOpenAppeal(expanded ? null : appeal.id)} type="button">
                  <span><strong>{application?.school_name ?? "School"}</strong><small>{application?.production_title ?? "Untitled production"} · {formatDate(appeal.submitted_at)}</small></span>
                  <span className={`badge badge-${appeal.status}`}>{statusLabel(appeal.status)}</span>
                </button>
                {expanded && <div className="appeal-card-body">
                  {appeal.category_id && <p><strong>Category:</strong> {categoryMap.get(appeal.category_id) ?? "Category"}</p>}
                  <div className="appeal-explanation"><strong>Appeal explanation</strong><p>{appeal.explanation}</p></div>
                  {appealFiles.length > 0 && <div className="appeal-file-list"><strong>Supporting files</strong>{appealFiles.map((file) => <button className="button button-secondary button-compact" key={file.id} onClick={() => void openFile(file)} type="button">{file.generated_name}</button>)}</div>}
                  {profile.role === "applicant" ? (
                    <div className="appeal-resolution-view">
                      {appeal.resolution ? <><strong>Resolution</strong><p>{appeal.resolution}</p></> : <p>GHSMTA staff are reviewing this appeal.</p>}
                    </div>
                  ) : (
                    <form className="form-stack appeal-review-form" onSubmit={(event) => { event.preventDefault(); void updateAppeal(appeal.id, new FormData(event.currentTarget)); }}>
                      <div className="field"><label>Status</label><select className="select" name="status" defaultValue={appeal.status}><option value="submitted">Submitted</option><option value="advisory_review">Advisory review</option><option value="owner_review">Owner review</option>{profile.role === "owner" && <><option value="resolved">Resolved</option><option value="denied">Denied</option></>}</select></div>
                      <div className="field"><label>Advisory Committee notes</label><textarea className="textarea" name="advisory_notes" defaultValue={appeal.advisory_notes ?? ""} rows={4} /></div>
                      {profile.role === "owner" && <><div className="field"><label>Owner notes</label><textarea className="textarea" name="owner_notes" defaultValue={appeal.owner_notes ?? ""} rows={4} /></div><div className="field"><label>School-facing resolution</label><textarea className="textarea" name="resolution" defaultValue={appeal.resolution ?? ""} rows={5} /></div></>}
                      <button className="button button-dark" type="submit">Save review</button>
                    </form>
                  )}
                </div>}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
