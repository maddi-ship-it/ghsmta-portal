import { updatePortalFeedbackRequest } from "./actions";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const STATUS_LABELS: Record<string, string> = { new: "New", needs_information: "Needs information", reviewing: "Reviewing", planned: "Planned", in_progress: "In progress", resolved: "Resolved", closed: "Closed" };

export default async function FeedbackPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  let query = supabase.from("portal_feedback_requests").select("id,reference_code,request_type,title,description,priority,status,owner_notes,page_url,created_at,updated_at,submitted_by").order("created_at", { ascending: false });
  if (profile.role !== "owner") query = query.eq("submitted_by", profile.id);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (
    <div className="page-stack">
      <header className="page-heading"><div><p className="eyebrow">Portal feedback</p><h1>{profile.role === "owner" ? "Bug and feature queue" : "My requests"}</h1><p>Track reported issues and requested improvements.</p></div></header>
      <div className="feedback-request-list">
        {(data ?? []).map((request) => (
          <article className="feedback-request-card" key={request.id}>
            <div className="feedback-request-header"><div><span className="status-pill">{STATUS_LABELS[request.status] ?? request.status}</span><h2>{request.title}</h2><p className="feedback-reference">{request.reference_code} · {request.request_type === "bug_report" ? "Bug report" : "Feature request"} · {request.priority}</p></div><time>{new Date(request.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}</time></div>
            <p>{request.description}</p>
            {request.owner_notes && <div className="owner-response"><strong>GHSMTA response</strong><p>{request.owner_notes}</p></div>}
            {profile.role === "owner" && (
              <form action={updatePortalFeedbackRequest.bind(null, request.id)} className="feedback-owner-form">
                <select className="select" name="status" defaultValue={request.status}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
                <textarea className="textarea" name="owner_notes" rows={3} defaultValue={request.owner_notes ?? ""} placeholder="Response visible to the submitter" />
                <button className="button button-secondary" type="submit">Save response</button>
              </form>
            )}
          </article>
        ))}
        {(data ?? []).length === 0 && <div className="empty-state"><h2>No requests yet</h2><p>Use the ? button in the menu bar whenever something needs attention.</p></div>}
      </div>
    </div>
  );
}
