import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, statusLabel } from "@/lib/format";
import type { Application } from "@/lib/types";
import { updateApplication } from "./actions";

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("applications").select("*").eq("id", id).single();
  if (!data) notFound();
  const application = data as Application;
  const canEdit = profile.role === "owner";
  const action = updateApplication.bind(null, id);

  return (
    <>
      <div className="page-heading"><div><h1>{application.school_name}</h1><p>{application.production_title ?? "Production title not entered"}</p></div><span className={`badge badge-${application.status}`}>{statusLabel(application.status)}</span></div>
      <div className="split-grid">
        <section className="panel">
          <div className="panel-header"><h2>Application record</h2></div>
          <div className="panel-body detail-grid">
            <div className="detail-item"><span>Status</span>{statusLabel(application.status)}</div>
            <div className="detail-item"><span>Submitted</span>{formatDate(application.submitted_at)}</div>
            <div className="detail-item"><span>Created</span>{formatDate(application.created_at)}</div>
            <div className="detail-item"><span>Last updated</span>{formatDate(application.updated_at)}</div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2>{canEdit ? "Owner controls" : "Application details"}</h2></div>
          <div className="panel-body">
            {canEdit ? (
              <form action={action} className="form-stack">
                <div className="field"><label htmlFor="school_name">School name</label><input className="input" id="school_name" name="school_name" defaultValue={application.school_name} required /></div>
                <div className="field"><label htmlFor="production_title">Production title</label><input className="input" id="production_title" name="production_title" defaultValue={application.production_title ?? ""} /></div>
                <div className="field"><label htmlFor="status">Status</label><select className="select" id="status" name="status" defaultValue={application.status}><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="complete">Complete</option><option value="withdrawn">Withdrawn</option></select></div>
                <div className="field"><label htmlFor="owner_notes">Internal owner notes</label><textarea className="textarea" id="owner_notes" name="owner_notes" defaultValue={application.owner_notes ?? ""} /></div>
                <button className="button button-dark" type="submit">Save application details</button>
              </form>
            ) : (
              <div className="detail-grid"><div className="detail-item"><span>School</span>{application.school_name}</div><div className="detail-item"><span>Production</span>{application.production_title ?? "—"}</div></div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
