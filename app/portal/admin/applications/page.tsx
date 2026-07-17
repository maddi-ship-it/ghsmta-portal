import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { statusLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Application, AwardCycle } from "@/lib/types";

import { startApplication } from "./actions";

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data, error }, { data: cycleData }] = await Promise.all([
    supabase
      .from("applications")
      .select(
        "id,cycle_id,form_version_id,applicant_user_id,school_name,production_title,status,submitted_at,form_version,form_data,owner_notes,current_stage_id,external_applicant_name,external_applicant_email,source_system,source_record_id,source_stage,is_archived,archived_payload,cloned_from_application_id,created_at,updated_at",
      )
      .order("updated_at", { ascending: false }),
    supabase
      .from("award_cycles")
      .select(
        "id,cycle_key,name,season_year,program_type,description,status,opens_at,closes_at,is_active,cloned_from_cycle_id,created_at,updated_at",
      )
      .order("season_year", { ascending: false })
      .order("name"),
  ]);

  const applications = (data ?? []) as Application[];
  const cycles = (cycleData ?? []) as AwardCycle[];
  const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const existingCycleIds = new Set(
    applications
      .filter((application) => application.applicant_user_id === profile.id)
      .map((application) => application.cycle_id),
  );
  const openPrograms = cycles.filter((cycle) => {
    if (!cycle.is_active || cycle.status !== "open") return false;
    return !existingCycleIds.has(cycle.id);
  });

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Applications</h1>
          <p>
            {profile.role === "applicant"
              ? "Start and manage each program application available to you."
              : "Applications visible under your assigned access level."}
          </p>
        </div>
      </div>

      {params.error && (
        <div className="form-error page-message">
          {params.message ?? "The application could not be started."}
        </div>
      )}

      {profile.role === "applicant" && openPrograms.length > 0 && (
        <section className="panel start-application-panel">
          <div className="panel-header">
            <div>
              <h2>Start another application</h2>
              <p>Choose the Director, scholarship, mentorship, or other open program.</p>
            </div>
          </div>
          <div className="panel-body">
            <form action={startApplication} className="form-stack start-application-form">
              <div className="field">
                <label htmlFor="cycle_id">Application program</label>
                <select className="select" id="cycle_id" name="cycle_id" required>
                  <option value="">Choose a program</option>
                  {openPrograms.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>
                      {cycle.season_year} — {cycle.name}
                    </option>
                  ))}
                </select>
              </div>
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
          </div>
        </section>
      )}

      {profile.role === "applicant" && applications.length === 0 && openPrograms.length === 0 && (
        <section className="panel">
          <div className="empty-state">
            <h3>No application programs are open.</h3>
            <p>Available applications will appear here when their program opens.</p>
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
            <p>Records will appear here once an application exists.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Program</th>
                  <th>School / applicant</th>
                  <th>Production</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => {
                  const cycle = cycleMap.get(application.cycle_id);
                  return (
                    <tr key={application.id}>
                      <td>
                        <strong>{cycle?.name ?? "Unknown program"}</strong>
                        <small>{cycle?.season_year}</small>
                      </td>
                      <td>
                        <strong>{application.school_name}</strong>
                        {application.external_applicant_name && (
                          <small>{application.external_applicant_name}</small>
                        )}
                      </td>
                      <td>{application.production_title ?? "Not entered"}</td>
                      <td>
                        <span className={`badge badge-${application.status}`}>
                          {statusLabel(application.status)}
                        </span>
                      </td>
                      <td>
                        {application.is_archived ? (
                          <span className="badge">Archive</span>
                        ) : (
                          "Portal"
                        )}
                      </td>
                      <td><Link href={`/portal/applications/${application.id}`}>Open</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
