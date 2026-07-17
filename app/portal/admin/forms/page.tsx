import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ApplicationFormVersion, AwardCycle } from "@/lib/types";

import { createFormVersion } from "./actions";

export default async function FormsPage() {
  await requireProfile(["owner"]);
  const supabase = await createClient();

  const [{ data: cycles }, { data: versions, error }] = await Promise.all([
    supabase
      .from("award_cycles")
      .select("id,name,season_year,opens_at,closes_at,is_active,created_at,updated_at")
      .order("season_year", { ascending: false }),
    supabase
      .from("application_form_versions")
      .select("id,cycle_id,version_number,name,status,published_at,created_at,updated_at")
      .order("created_at", { ascending: false }),
  ]);

  const awardCycles = (cycles ?? []) as AwardCycle[];
  const formVersions = (versions ?? []) as ApplicationFormVersion[];
  const cycleMap = new Map(awardCycles.map((cycle) => [cycle.id, cycle]));

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Application forms</h1>
          <p>Create a versioned application for each awards cycle.</p>
        </div>
      </div>

      <div className="split-grid">
        <section className="panel">
          <div className="panel-header"><h2>Form versions</h2></div>
          {error ? (
            <div className="empty-state">
              <h3>Forms could not be loaded.</h3>
              <p>{error.message}</p>
            </div>
          ) : formVersions.length === 0 ? (
            <div className="empty-state">
              <h3>No application forms yet.</h3>
              <p>Create a form version for an existing awards cycle.</p>
            </div>
          ) : (
            <div className="panel-body form-stack">
              {formVersions.map((version) => {
                const cycle = cycleMap.get(version.cycle_id);
                return (
                <Link
                  className="record-link"
                  href={`/portal/admin/forms/${version.id}`}
                  key={version.id}
                >
                  <span>
                    <strong>{version.name}</strong>
                    <small>
                      {cycle?.season_year ?? "Unknown cycle"} · Version {version.version_number}
                    </small>
                  </span>
                  <span className={`badge badge-form-${version.status}`}>
                    {version.status}
                  </span>
                </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-header"><h2>Create form version</h2></div>
          <div className="panel-body">
            {awardCycles.length === 0 ? (
              <p>Create an awards cycle before creating its application form.</p>
            ) : (
              <form action={createFormVersion} className="form-stack">
                <div className="field">
                  <label htmlFor="cycle_id">Awards cycle</label>
                  <select className="select" id="cycle_id" name="cycle_id" required>
                    <option value="">Select a cycle</option>
                    {awardCycles.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {cycle.season_year} — {cycle.name}{cycle.is_active ? " (active)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="name">Form name</label>
                  <input
                    className="input"
                    id="name"
                    name="name"
                    placeholder="2026–2027 Director Application"
                    required
                  />
                </div>
                <button className="button button-dark" type="submit">
                  Create and open builder
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
