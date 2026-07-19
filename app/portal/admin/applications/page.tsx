import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { statusLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Application, AwardCycle } from "@/lib/types";

import { setApplicationArchiveState, startApplication } from "./actions";

type ApplicationSort =
  | "updated"
  | "school"
  | "production"
  | "program"
  | "season"
  | "status";

type SortDirection = "asc" | "desc";

type ApplicationSearchParams = {
  error?: string;
  message?: string;
  q?: string;
  cycle?: string;
  program?: string;
  status?: string;
  sort?: ApplicationSort;
  direction?: SortDirection;
  archived?: string;
  restored?: string;
};

function textCompare(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "").localeCompare(right ?? "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function applicationMatchesSearch(application: Application, search: string) {
  if (!search) return true;
  const haystack = [
    application.school_name,
    application.production_title,
    application.external_applicant_name,
    application.external_applicant_email,
    application.source_record_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();

  return haystack.includes(search.toLocaleLowerCase());
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<ApplicationSearchParams>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data, error }, { data: cycleData }] = await Promise.all([
    supabase
      .from("applications")
      .select(
        "id,cycle_id,form_version_id,applicant_user_id,school_name,production_title,status,submitted_at,form_version,form_data,owner_notes,current_stage_id,external_applicant_name,external_applicant_email,source_system,source_record_id,source_stage,is_archived,archived_at,archived_by,archive_reason,archived_payload,cloned_from_application_id,created_at,updated_at",
      )
      .eq("is_archived", false),
    supabase
      .from("award_cycles")
      .select(
        "id,cycle_key,name,season_year,program_type,description,status,opens_at,closes_at,is_active,cloned_from_cycle_id,created_at,updated_at",
      )
      .neq("status", "archived")
      .order("season_year", { ascending: false })
      .order("name"),
  ]);

  const cycles = (cycleData ?? []) as AwardCycle[];
  const activeCycleIds = new Set(cycles.map((cycle) => cycle.id));
  const applications = ((data ?? []) as Application[]).filter(
    (application) => activeCycleIds.has(application.cycle_id),
  );
  const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const existingCycleIds = new Set(
    applications.map((application) => application.cycle_id),
  );
  const openPrograms = cycles.filter((cycle) => {
    if (!cycle.is_active || cycle.status !== "open") return false;
    return !existingCycleIds.has(cycle.id);
  });

  const search = params.q?.trim() ?? "";
  const selectedCycle = params.cycle ?? "";
  const selectedProgram = params.program ?? "";
  const selectedStatus = params.status ?? "";
  const sort = params.sort ?? "updated";
  const direction = params.direction ?? "desc";

  const filteredApplications = applications.filter((application) => {
    const cycle = cycleMap.get(application.cycle_id);
    if (!applicationMatchesSearch(application, search)) return false;
    if (selectedCycle && application.cycle_id !== selectedCycle) return false;
    if (selectedProgram && cycle?.program_type !== selectedProgram) return false;
    if (selectedStatus && application.status !== selectedStatus) return false;
    return true;
  });

  filteredApplications.sort((left, right) => {
    const leftCycle = cycleMap.get(left.cycle_id);
    const rightCycle = cycleMap.get(right.cycle_id);
    let result = 0;

    switch (sort) {
      case "school":
        result = textCompare(left.school_name, right.school_name);
        break;
      case "production":
        result = textCompare(left.production_title, right.production_title);
        break;
      case "program":
        result = textCompare(leftCycle?.name, rightCycle?.name);
        break;
      case "season":
        result = textCompare(leftCycle?.season_year, rightCycle?.season_year);
        break;
      case "status":
        result = textCompare(left.status, right.status);
        break;
      case "updated":
      default:
        result = new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime();
        break;
    }

    if (result === 0) result = textCompare(left.school_name, right.school_name);
    return direction === "asc" ? result : -result;
  });

  const programTypes = [...new Set(cycles.map((cycle) => cycle.program_type))].sort();
  const statusOptions = [...new Set(applications.map((application) => application.status))].sort();
  const hasFilters = Boolean(
    search || selectedCycle || selectedProgram || selectedStatus,
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Applications</h1>
          <p>
            {profile.role === "applicant"
              ? "Start and manage each program application available to you."
              : "Search, filter, sort, and review active applications visible under your access level."}
          </p>
        </div>
        {profile.role === "owner" && (
          <Link className="button button-secondary" href="/portal/admin/archive">
            View archive
          </Link>
        )}
      </div>

      {params.error && (
        <div className="form-error page-message">
          {params.message ?? "The application could not be started."}
        </div>
      )}
      {params.archived && <div className="notice page-message">Archived {params.archived} application record{params.archived === "1" ? "" : "s"}.</div>}
      {params.restored && <div className="notice page-message">Restored {params.restored} application record{params.restored === "1" ? "" : "s"}.</div>}

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

      {profile.role !== "applicant" && (
        <section className="panel application-filter-panel">
          <div className="panel-header">
            <div>
              <h2>Find applications</h2>
              <p>
                Showing {filteredApplications.length} of {applications.length} accessible applications.
              </p>
            </div>
            {hasFilters && (
              <Link className="button button-secondary button-compact" href="/portal/admin/applications">
                Clear filters
              </Link>
            )}
          </div>
          <div className="panel-body">
            <form className="application-filter-form" method="get">
              <div className="field application-filter-search">
                <label htmlFor="q">Search</label>
                <input
                  className="input"
                  defaultValue={search}
                  id="q"
                  name="q"
                  placeholder="School, production, applicant, or source ID"
                />
              </div>
              <div className="field">
                <label htmlFor="cycle">Cycle</label>
                <select className="select" defaultValue={selectedCycle} id="cycle" name="cycle">
                  <option value="">All cycles</option>
                  {cycles.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>
                      {cycle.season_year} — {cycle.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="program">Program type</label>
                <select className="select" defaultValue={selectedProgram} id="program" name="program">
                  <option value="">All program types</option>
                  {programTypes.map((programType) => (
                    <option key={programType} value={programType}>
                      {programType.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="status">Status</label>
                <select className="select" defaultValue={selectedStatus} id="status" name="status">
                  <option value="">All statuses</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="sort">Sort by</label>
                <select className="select" defaultValue={sort} id="sort" name="sort">
                  <option value="updated">Last updated</option>
                  <option value="school">School</option>
                  <option value="production">Production</option>
                  <option value="program">Program</option>
                  <option value="season">Season</option>
                  <option value="status">Status</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="direction">Direction</label>
                <select className="select" defaultValue={direction} id="direction" name="direction">
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
              <button className="button button-dark application-filter-submit" type="submit">
                Apply
              </button>
            </form>
          </div>
        </section>
      )}

      <section className="panel">
        {error ? (
          <div className="empty-state">
            <h3>Applications could not be loaded.</h3>
            <p>{error.message}</p>
          </div>
        ) : filteredApplications.length === 0 ? (
          <div className="empty-state">
            <h3>{hasFilters ? "No applications match these filters." : "No accessible applications."}</h3>
            <p>
              {hasFilters
                ? "Try broadening the search or clearing one of the filters."
                : "Records will appear here once an application exists."}
            </p>
          </div>
        ) : (
          <form action={setApplicationArchiveState} className="application-archive-form">
            {profile.role === "owner" && (
              <div className="application-archive-toolbar">
                <div><strong>Archive applications</strong><small>Select active records to move them out of every main workspace. Historical data remains available under View archive.</small></div>
                <input className="input" name="archive_reason" placeholder="Optional archive reason" />
                <button className="button button-dark button-compact" name="bulk_archive_action" type="submit" value="archive">Archive selected</button>
              </div>
            )}
            <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {profile.role === "owner" && <th><span className="sr-only">Select</span></th>}
                  <th>Program</th>
                  <th>School / applicant</th>
                  <th>Production</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredApplications.map((application) => {
                  const cycle = cycleMap.get(application.cycle_id);
                  return (
                    <tr key={application.id}>
                      {profile.role === "owner" && <td><input aria-label={`Select ${application.school_name}`} name="application_ids" type="checkbox" value={application.id} /></td>}
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
                        {application.source_system ? "Imported" : "Portal"}
                      </td>
                      <td>
                        <span className="table-date">
                          {new Date(application.updated_at).toLocaleDateString()}
                        </span>
                        <small>
                          {new Date(application.updated_at).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </small>
                      </td>
                      <td>
                        <div className="application-row-actions">
                          <Link href={`/portal/applications/${application.id}`}>Open</Link>
                          {profile.role === "owner" && (
                            <button className="text-button danger-text" name="single_archive_id" type="submit" value={application.id}>Archive</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
