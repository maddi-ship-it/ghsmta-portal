import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { FEEDBACK_STATUS_LABELS } from "@/lib/feedback";
import { createClient } from "@/lib/supabase/server";

export default async function FeedbackPage() {
  const profile = await requireProfile();
  if (profile.role === "owner") redirect("/portal/admin/feedback");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portal_feedback_requests")
    .select("id,reference_code,request_type,title,description,priority,status,owner_notes,page_url,created_at,updated_at,submitted_by")
    .eq("submitted_by", profile.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (
    <div className="page-stack">
      <header className="page-heading"><div><p className="eyebrow">Portal feedback</p><h1>My requests</h1><p>Track reported issues and requested improvements.</p></div></header>
      <div className="feedback-request-list">
        {(data ?? []).map((request) => (
          <article className="feedback-request-card" key={request.id}>
            <div className="feedback-request-header"><div><span className="status-pill">{FEEDBACK_STATUS_LABELS[request.status as keyof typeof FEEDBACK_STATUS_LABELS] ?? request.status}</span><h2>{request.title}</h2><p className="feedback-reference">{request.reference_code} · {request.request_type === "bug_report" ? "Bug report" : "Feature request"} · {request.priority}</p></div><time>{new Date(request.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}</time></div>
            <p>{request.description}</p>
            {request.owner_notes && <div className="owner-response"><strong>GHSMTA response</strong><p>{request.owner_notes}</p></div>}
          </article>
        ))}
        {(data ?? []).length === 0 && <div className="empty-state"><h2>No requests yet</h2><p>Use the ? button in the menu bar whenever something needs attention.</p></div>}
      </div>
    </div>
  );
}
