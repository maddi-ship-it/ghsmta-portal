"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createEligibilityAppeal,
  createScholarshipRequest,
  reviewEligibilityAppeal,
  reviewScholarshipRequest,
} from "@/app/portal/appeals/actions";
import { uploadPortalFiles } from "@/lib/portal-file-client";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

type Appeal = { id: string; application_id: string; category_id: string | null; explanation: string; status: string; advisory_notes: string | null; owner_notes: string | null; resolution: string | null; submitted_at: string; resolved_at: string | null; current_eligibility: boolean | null; requested_eligibility: boolean; school_contact_name: string | null; school_contact_email: string | null; school_contact_phone: string | null };
type ScholarshipRequest = { id: string; application_id: string; submitted_by: string; request_type: string; amount_requested_cents: number | null; explanation: string; financial_context: string | null; status: string; owner_notes: string | null; resolution: string | null; reviewed_at: string | null; submitted_at: string; school_contact_name: string | null; school_contact_email: string | null; school_contact_phone: string | null };
type ApplicationOption = { id: string; school_name: string; production_title: string | null; cycle_id: string; scoring_rubric_id: string | null };
type CategoryOption = {
  id: string;
  title: string;
  rubric_id: string;
};
type CycleOption = { id: string; name: string; season_year: string };
type PortalFile = { id: string; context_id: string; original_name: string; generated_name: string; storage_path: string; mime_type: string | null; file_size: number | null; created_at: string };
function statusLabel(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function requestTypeLabel(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatAmount(cents: number | null) { return cents == null ? "No amount specified" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }

export function AppealWorkspace({
  profile,
  applications,
  appeals,
  categories,
  cycles,
  files,
  scholarshipFiles,
  scholarshipRequests,
}: {
  profile: Profile;
  applications: ApplicationOption[];
  appeals: Appeal[];
  categories: CategoryOption[];
  cycles: CycleOption[];
  files: PortalFile[];
  scholarshipFiles: PortalFile[];
  scholarshipRequests: ScholarshipRequest[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [creating, setCreating] = useState(false);
  const [creatingScholarship, setCreatingScholarship] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openAppeal, setOpenAppeal] = useState<string | null>(appeals[0]?.id ?? null);
  const [openScholarshipRequest, setOpenScholarshipRequest] = useState<string | null>(scholarshipRequests[0]?.id ?? null);
  const [selectedApplicationId, setSelectedApplicationId] = useState(
    applications[0]?.id ?? "",
  );
  const [selectedScholarshipApplicationId, setSelectedScholarshipApplicationId] = useState(
    applications[0]?.id ?? "",
  );
  const applicationMap = new Map(applications.map((application) => [application.id, application]));
  const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const categoryMap = new Map(
    categories.map((category) => [category.id, category.title]),
  );
  const selectedApplication = applicationMap.get(selectedApplicationId);
  const availableCategories = selectedApplication
    ? categories.filter(
        (category) => category.rubric_id === selectedApplication.scoring_rubric_id,
      )
    : [];

  async function submitAppeal(form: HTMLFormElement) {
    setCreating(true); setMessage(null); setError(null);
    const formData = new FormData(form);
    const filesToUpload = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    formData.delete("files");
    try {
      const result = await createEligibilityAppeal(formData);
      if (!result.ok || !result.id) throw new Error(result.error ?? "Could not submit eligibility appeal.");
      const application = applicationMap.get(String(formData.get("application_id")));
      if (filesToUpload.length > 0 && application) {
        const cycle = cycleMap.get(application.cycle_id);
        await uploadPortalFiles({ files: filesToUpload, contextType: "appeal", contextId: result.id, applicationId: application.id, userId: profile.id, season: cycle?.season_year, program: cycle?.name, school: application.school_name, documentType: "Eligibility-Appeal-Supporting-Document", documentCategory: "eligibility_appeal", reviewerVisible: true });
      }
      form.reset(); setMessage("Category eligibility appeal submitted for Advisory and Owner review."); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not submit eligibility appeal."); }
    finally { setCreating(false); }
  }

  async function submitScholarshipRequest(form: HTMLFormElement) {
    setCreatingScholarship(true); setMessage(null); setError(null);
    const formData = new FormData(form);
    const filesToUpload = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    formData.delete("files");
    try {
      const result = await createScholarshipRequest(formData);
      if (!result.ok || !result.id) throw new Error(result.error ?? "Could not submit scholarship request.");
      const application = applicationMap.get(String(formData.get("application_id")));
      if (filesToUpload.length > 0 && application) {
        const cycle = cycleMap.get(application.cycle_id);
        await uploadPortalFiles({
          files: filesToUpload,
          contextType: "scholarship_request",
          contextId: result.id,
          applicationId: application.id,
          userId: profile.id,
          season: cycle?.season_year,
          program: cycle?.name,
          school: application.school_name,
          documentType: "Scholarship-Request-Supporting-Document",
          documentCategory: "scholarship_request",
          reviewerVisible: false,
        });
      }
      form.reset();
      setMessage("Scholarship request submitted. Owners have been notified.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not submit scholarship request.");
    } finally {
      setCreatingScholarship(false);
    }
  }

  async function openFile(file: PortalFile) {
    const { data, error: signedError } = await supabase.storage.from("portal-files").createSignedUrl(file.storage_path, 3600);
    if (signedError || !data?.signedUrl) { setError(signedError?.message ?? "Could not open file."); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="appeal-workspace">
      {profile.role === "applicant" && (
        <>
          <section className="panel appeal-submit-panel">
            <div className="panel-header"><div><h2>Submit a category eligibility appeal</h2><p>This form is only for appealing whether a specific award category is eligible. It cannot be used to challenge scores, rankings, or adjudicator narratives.</p></div></div>
            <div className="panel-body">
              <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void submitAppeal(event.currentTarget); }}>
                <div className="form-grid two-column-form">
                  <div className="field"><label htmlFor="appeal_application">Application</label><select
                    className="select"
                    id="appeal_application"
                    name="application_id"
                    onChange={(event) =>
                      setSelectedApplicationId(event.currentTarget.value)
                    }
                    required
                    value={selectedApplicationId}
                  >
                    <option value="">Select application</option>
                    {applications.map((application) => (
                      <option key={application.id} value={application.id}>
                        {application.school_name} —{" "}
                        {application.production_title ?? "Untitled production"}
                      </option>
                    ))}
                  </select></div>
                  <div className="field"><label htmlFor="appeal_category">Category</label><select
                    className="select"
                    id="appeal_category"
                    name="category_id"
                    required
                  >
                    <option value="">Choose category from scoring guide</option>
                    {availableCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.title}
                      </option>
                    ))}
                  </select>
                  {selectedApplication && availableCategories.length === 0 && (
                    <small className="field-warning">
                      This application form does not have an assigned scoring guide.
                    </small>
                  )}</div>
                </div>
                <div className="field"><label htmlFor="current_eligibility">Current determination</label><select className="select" id="current_eligibility" name="current_eligibility" required><option value="false">Not eligible</option><option value="true">Eligible — correction or clarification requested</option></select></div>
                <div className="field"><label htmlFor="appeal_explanation">Why should this category be eligible?</label><textarea className="textarea" id="appeal_explanation" name="explanation" required rows={8} minLength={10} placeholder="Reference the production, application materials, and eligibility requirement that supports this appeal." /></div>
                <div className="form-grid three-column-form"><div className="field"><label htmlFor="appeal_contact_name">School contact</label><input className="input" id="appeal_contact_name" name="school_contact_name" defaultValue={profile.full_name ?? ""} required /></div><div className="field"><label htmlFor="appeal_contact_email">Contact email</label><input className="input" id="appeal_contact_email" name="school_contact_email" type="email" defaultValue={profile.email ?? ""} required /></div><div className="field"><label htmlFor="appeal_contact_phone">Contact phone</label><input className="input" id="appeal_contact_phone" name="school_contact_phone" type="tel" defaultValue={profile.phone_e164 ?? ""} required /></div></div>
                <div className="field"><label htmlFor="appeal_files">Supporting files</label><input className="input file-input" id="appeal_files" multiple name="files" type="file" /><small>Upload documents that directly support category eligibility.</small></div>
                <label className="certification-box"><input name="certification_accepted" type="checkbox" required /><span>I certify that the information submitted is accurate and that this request concerns category eligibility only.</span></label>
                <button className="button button-gold" disabled={creating} type="submit">{creating ? "Submitting…" : "Submit eligibility appeal"}</button>
              </form>
            </div>
          </section>

          <section className="panel scholarship-submit-panel">
            <div className="panel-header"><div><h2>Request scholarship support</h2><p>Use this when your school needs financial support connected to participation. Scholarship requests notify GHSMTA Owners only.</p></div></div>
            <div className="panel-body">
              <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void submitScholarshipRequest(event.currentTarget); }}>
                <div className="form-grid three-column-form">
                  <div className="field"><label htmlFor="scholarship_application">Application</label><select className="select" id="scholarship_application" name="application_id" onChange={(event) => setSelectedScholarshipApplicationId(event.currentTarget.value)} required value={selectedScholarshipApplicationId}><option value="">Select application</option>{applications.map((application) => <option key={application.id} value={application.id}>{application.school_name} — {application.production_title ?? "Untitled production"}</option>)}</select></div>
                  <div className="field"><label htmlFor="scholarship_request_type">Request type</label><select className="select" id="scholarship_request_type" name="request_type" required><option value="program_fee">Program fee</option><option value="travel">Travel support</option><option value="accessibility">Accessibility support</option><option value="other">Other</option></select></div>
                  <div className="field"><label htmlFor="scholarship_amount">Requested amount</label><input className="input" id="scholarship_amount" inputMode="decimal" name="amount_requested" placeholder="Optional, e.g. 250.00" /></div>
                </div>
                <div className="field"><label htmlFor="scholarship_explanation">What support is being requested?</label><textarea className="textarea" id="scholarship_explanation" name="explanation" required rows={7} minLength={10} placeholder="Describe the support needed and how it affects your school's participation." /></div>
                <div className="field"><label htmlFor="scholarship_context">Financial context <span>Optional</span></label><textarea className="textarea compact-textarea" id="scholarship_context" name="financial_context" rows={4} placeholder="Share any timing, funding, or budget context that would help Owners review the request." /></div>
                <div className="form-grid three-column-form"><div className="field"><label htmlFor="scholarship_contact_name">School contact</label><input className="input" id="scholarship_contact_name" name="school_contact_name" defaultValue={profile.full_name ?? ""} required /></div><div className="field"><label htmlFor="scholarship_contact_email">Contact email</label><input className="input" id="scholarship_contact_email" name="school_contact_email" type="email" defaultValue={profile.email ?? ""} required /></div><div className="field"><label htmlFor="scholarship_contact_phone">Contact phone</label><input className="input" id="scholarship_contact_phone" name="school_contact_phone" type="tel" defaultValue={profile.phone_e164 ?? ""} required /></div></div>
                <div className="field"><label htmlFor="scholarship_files">Supporting files</label><input className="input file-input" id="scholarship_files" multiple name="files" type="file" /><small>Optional documents are visible to Owners only.</small></div>
                <label className="certification-box"><input name="certification_accepted" type="checkbox" required /><span>I certify that this scholarship request is accurate and should be reviewed by GHSMTA Owners.</span></label>
                <button className="button button-gold" disabled={creatingScholarship} type="submit">{creatingScholarship ? "Submitting…" : "Submit scholarship request"}</button>
              </form>
            </div>
          </section>
        </>
      )}

      {(message || error) && <div className={error ? "form-error page-message" : "notice-banner success-banner page-message"}>{error ?? message}</div>}

      <section className="panel"><div className="panel-header"><div><h2>{profile.role === "applicant" ? "My eligibility appeals" : "Eligibility appeal review queue"}</h2><p>{appeals.length} appeal{appeals.length === 1 ? "" : "s"}</p></div></div><div className="appeal-list">
        {appeals.length === 0 ? <div className="empty-state"><h3>No category eligibility appeals</h3><p>Submitted appeals will appear here.</p></div> : appeals.map((appeal) => { const application = applicationMap.get(appeal.application_id); const appealFiles = files.filter((file) => file.context_id === appeal.id); const expanded = openAppeal === appeal.id; return <article className="appeal-card" key={appeal.id}><button className="appeal-card-summary" onClick={() => setOpenAppeal(expanded ? null : appeal.id)} type="button"><span><strong>{application?.school_name ?? "School"}</strong><small>{categoryMap.get(appeal.category_id ?? "") ?? "Category"} · {formatDate(appeal.submitted_at)}</small></span><span className={`badge badge-${appeal.status}`}>{statusLabel(appeal.status)}</span></button>{expanded && <div className="appeal-card-body"><div className="eligibility-appeal-summary"><span><small>Current determination</small><strong>{appeal.current_eligibility ? "Eligible" : "Not eligible"}</strong></span><span><small>Requested determination</small><strong>Eligible</strong></span></div><div className="appeal-explanation"><strong>School explanation</strong><p>{appeal.explanation}</p></div>{appealFiles.length > 0 && <div className="appeal-file-list"><strong>Supporting files</strong>{appealFiles.map((file) => <button className="button button-secondary button-compact" key={file.id} onClick={() => void openFile(file)} type="button">{file.generated_name}</button>)}</div>}{profile.role === "applicant" ? <div className="appeal-resolution-view">{appeal.resolution ? <><strong>Final eligibility decision</strong><p>{appeal.resolution}</p></> : <p>GHSMTA is reviewing this category eligibility appeal.</p>}</div> : <EligibilityReviewForm appeal={appeal} isOwner={profile.role === "owner"} />}</div>}</article>; })}
      </div></section>

      {(profile.role === "applicant" || profile.role === "owner") && (
        <section className="panel"><div className="panel-header"><div><h2>{profile.role === "applicant" ? "My scholarship requests" : "Scholarship request review queue"}</h2><p>{scholarshipRequests.length} request{scholarshipRequests.length === 1 ? "" : "s"} · Owners only</p></div></div><div className="appeal-list">
          {scholarshipRequests.length === 0 ? <div className="empty-state"><h3>No scholarship requests</h3><p>Submitted scholarship requests will appear here.</p></div> : scholarshipRequests.map((request) => { const application = applicationMap.get(request.application_id); const requestFiles = scholarshipFiles.filter((file) => file.context_id === request.id); const expanded = openScholarshipRequest === request.id; return <article className="appeal-card scholarship-request-card" key={request.id}><button className="appeal-card-summary" onClick={() => setOpenScholarshipRequest(expanded ? null : request.id)} type="button"><span><strong>{application?.school_name ?? "School"}</strong><small>{requestTypeLabel(request.request_type)} · {formatAmount(request.amount_requested_cents)} · {formatDate(request.submitted_at)}</small></span><span className={`badge badge-${request.status}`}>{statusLabel(request.status)}</span></button>{expanded && <div className="appeal-card-body"><div className="eligibility-appeal-summary"><span><small>Request type</small><strong>{requestTypeLabel(request.request_type)}</strong></span><span><small>Requested amount</small><strong>{formatAmount(request.amount_requested_cents)}</strong></span></div><div className="appeal-explanation"><strong>School request</strong><p>{request.explanation}</p>{request.financial_context && <><strong>Financial context</strong><p>{request.financial_context}</p></>}</div>{requestFiles.length > 0 && <div className="appeal-file-list"><strong>Supporting files</strong>{requestFiles.map((file) => <button className="button button-secondary button-compact" key={file.id} onClick={() => void openFile(file)} type="button">{file.generated_name}</button>)}</div>}{profile.role === "applicant" ? <div className="appeal-resolution-view">{request.resolution ? <><strong>Owner response</strong><p>{request.resolution}</p></> : <p>GHSMTA Owners are reviewing this scholarship request.</p>}</div> : <ScholarshipReviewForm request={request} />}</div>}</article>; })}
        </div></section>
      )}
    </div>
  );
}

function EligibilityReviewForm({ appeal, isOwner }: { appeal: Appeal; isOwner: boolean }) {
  return <form action={reviewEligibilityAppeal.bind(null, appeal.id)} className="form-stack appeal-review-form"><div className="field"><label>Status</label><select className="select" name="status" defaultValue={appeal.status}><option value="submitted">Submitted</option><option value="advisory_review">Advisory review</option><option value="owner_review">Owner review</option>{isOwner && <><option value="resolved">Approved — mark eligible</option><option value="denied">Denied</option></>}</select></div><div className="field"><label>Advisory Committee notes</label><textarea className="textarea" name="advisory_notes" defaultValue={appeal.advisory_notes ?? ""} rows={4} /></div>{isOwner && <><div className="field"><label>Owner notes</label><textarea className="textarea" name="owner_notes" defaultValue={appeal.owner_notes ?? ""} rows={4} /></div><div className="field"><label>School-facing final decision</label><textarea className="textarea" name="resolution" defaultValue={appeal.resolution ?? ""} rows={5} required /></div></>}<button className="button button-gold" type="submit">Save eligibility review</button></form>;
}

function ScholarshipReviewForm({ request }: { request: ScholarshipRequest }) {
  return <form action={reviewScholarshipRequest.bind(null, request.id)} className="form-stack appeal-review-form"><div className="field"><label>Status</label><select className="select" name="status" defaultValue={request.status}><option value="submitted">Submitted</option><option value="owner_review">Owner review</option><option value="approved">Approved</option><option value="denied">Denied</option><option value="withdrawn">Withdrawn</option></select></div><div className="field"><label>Owner notes</label><textarea className="textarea" name="owner_notes" defaultValue={request.owner_notes ?? ""} rows={4} /></div><div className="field"><label>School-facing response</label><textarea className="textarea" name="resolution" defaultValue={request.resolution ?? ""} rows={5} /></div><button className="button button-gold" type="submit">Save scholarship review</button></form>;
}
