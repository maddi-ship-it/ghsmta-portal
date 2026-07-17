import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { statusLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Application } from "@/lib/types";

import { startApplication } from "./actions";

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("id,cycle_id,form_version_id,applicant_user_id,school_name,production_title,status,submitted_at,form_version,form_data,owner_notes,created_at,updated_at")
    .order("school_name");
  const applications = (data ?? []) as Application[];

  const { data: activeCycle } = profile.role === "applicant"
    ? await supabase
        .from("award_cycles")
        .select("id,name,season_year,opens_at,closes_at,is_active")
        .eq("is_active", true)
        .maybeSingle()
    : { data: null };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Applications</h1>
          <p>
            {profile.role === "applicant"
              ? "Your school application."
              : "Applications visible under your assigned access level."}
          </p>
        </div>
      </div>

      {params.error && (
        <div className="form-error page-message">
          {params.message ?? "The application could not be started."}
        </div>
      )}

      {profile.role === "applicant" && applications.length === 0 && (
        <section className="panel start-application-panel">
          <div className="panel-header">
            <div>
              <h2>Start your application</h2>
              <p>
                {activeCycle
                  ? `${activeCycle.name} is currently active.`
                  : "There is not currently an open awards cycle."}
              </p>
            </div>
          </div>
          <div className="panel-body">
            {activeCycle ? (
              <form action={startApplication} className="form-stack start-application-form">
                <div className="field">
                  <label htmlFor="school_name">School name</label>
                  <input className="input" id="school_name" name="school_name" required />
                </div>
                <div className="field">
                  <label htmlFor="production_title">Production title</label>
                  <input className="input" id="production_title" name="production_title" />
                </div>
                <button className="button button-dark" type="submit">
                  Start application
                </button>
              </form>
            ) : (
              <p>An owner must activate a cycle and publish its form before applications can begin.</p>
            )}
          </div>
        </section>
      )}

      <section className="panel">
        {error ? (
          <div className="empty-state">
            <h3>Applications could not be loaded.</h3>
            <p>{error.message}</p>
          </div>
        ) : applications.length === 0 ? (
          <div className="empty-state">
            <h3>No accessible applications.</h3>
            <p>
              Records will appear here once a cycle, published form, and application exist.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>School</th>
                  <th>Production</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => (
                  <tr key={application.id}>
                    <td><strong>{application.school_name}</strong></td>
                    <td>{application.production_title ?? "Not entered"}</td>
                    <td>
                      <span className={`badge badge-${application.status}`}>
                        {statusLabel(application.status)}
                      </span>
                    </td>
                    <td>
                      {application.submitted_at
                        ? new Date(application.submitted_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td><Link href={`/portal/applications/${application.id}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
