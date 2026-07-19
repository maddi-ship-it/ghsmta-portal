import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { roleLabel, statusLabel } from "@/lib/format";
import type { Application } from "@/lib/types";

export default async function PortalDashboard() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("applications")
    .select("id,cycle_id,applicant_user_id,school_name,production_title,status,submitted_at,form_data,owner_notes,created_at,updated_at,award_cycles!inner(is_active,status)")
    .eq("is_archived", false)
    .eq("award_cycles.is_active", true)
    .neq("award_cycles.status", "archived")
    .order("updated_at", { ascending: false });
  const applications = (data ?? []) as unknown as Application[];

  const counts = {
    total: applications.length,
    draft: applications.filter((item) => item.status === "draft").length,
    submitted: applications.filter((item) => item.status === "submitted").length,
    review: applications.filter((item) => item.status === "under_review").length,
  };

  const intro = profile.role === "applicant"
    ? "Manage your school’s application and submission status."
    : profile.role === "adjudicator"
      ? "Review the applications currently assigned to you."
      : `View the current awards cycle as an ${roleLabel(profile.role).toLowerCase()}.`;

  return (
    <>
      <div className="page-heading">
        <div><h1>Welcome, {profile.full_name?.split(" ")[0] ?? "there"}.</h1><p>{intro}</p></div>
        <Link className="button button-dark" href="/portal/admin/applications">View applications</Link>
      </div>

      <section className="metric-grid" aria-label="Application overview">
        <article className="metric-card"><span className="metric-label">Accessible</span><strong className="metric-value">{counts.total}</strong></article>
        <article className="metric-card"><span className="metric-label">Draft</span><strong className="metric-value">{counts.draft}</strong></article>
        <article className="metric-card"><span className="metric-label">Submitted</span><strong className="metric-value">{counts.submitted}</strong></article>
        <article className="metric-card"><span className="metric-label">In review</span><strong className="metric-value">{counts.review}</strong></article>
      </section>

      <section className="panel">
        <div className="panel-header"><h2>Recently updated</h2><Link href="/portal/admin/applications">See all</Link></div>
        {applications.length === 0 ? (
          <div className="empty-state">
            <h3>No applications are available yet.</h3>
            <p>{profile.role === "applicant" ? "Once an owner opens an awards cycle, your application can be created here." : "Create or activate an awards cycle, then applicant records will appear here according to your role."}</p>
          </div>
        ) : (
          <div className="table-wrap"><table className="data-table"><thead><tr><th>School</th><th>Production</th><th>Status</th><th>Updated</th></tr></thead><tbody>
            {applications.slice(0, 8).map((application) => (
              <tr key={application.id}>
                <td><Link href={`/portal/applications/${application.id}`}>{application.school_name}</Link></td>
                <td>{application.production_title ?? "Not entered"}</td>
                <td><span className={`badge badge-${application.status}`}>{statusLabel(application.status)}</span></td>
                <td>{new Date(application.updated_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </section>
    </>
  );
}
