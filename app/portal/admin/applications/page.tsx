import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { statusLabel } from "@/lib/format";
import type { Application } from "@/lib/types";

export default async function ApplicationsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("id,cycle_id,applicant_user_id,school_name,production_title,status,submitted_at,form_data,owner_notes,created_at,updated_at")
    .order("school_name");
  const applications = (data ?? []) as Application[];

  return (
    <>
      <div className="page-heading"><div><h1>Applications</h1><p>{profile.role === "applicant" ? "Your school application." : "Applications visible under your assigned access level."}</p></div></div>
      <section className="panel">
        {error ? <div className="empty-state"><h3>Applications could not be loaded.</h3><p>{error.message}</p></div> : applications.length === 0 ? (
          <div className="empty-state"><h3>No accessible applications.</h3><p>The database permissions are active; records will appear here once a cycle and application exist.</p></div>
        ) : (
          <div className="table-wrap"><table className="data-table"><thead><tr><th>School</th><th>Production</th><th>Status</th><th>Submitted</th><th></th></tr></thead><tbody>
            {applications.map((application) => (
              <tr key={application.id}>
                <td><strong>{application.school_name}</strong></td>
                <td>{application.production_title ?? "Not entered"}</td>
                <td><span className={`badge badge-${application.status}`}>{statusLabel(application.status)}</span></td>
                <td>{application.submitted_at ? new Date(application.submitted_at).toLocaleDateString() : "—"}</td>
                <td><Link href={`/portal/applications/${application.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </section>
    </>
  );
}
