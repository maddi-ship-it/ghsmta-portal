import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AwardCycle, ProgramType } from "@/lib/types";

import {
  activateCycle,
  createCycle,
  deactivateCycle,
  duplicateCycle,
} from "./actions";

const PROGRAM_TYPES: Array<{ value: ProgramType; label: string }> = [
  { value: "directors", label: "Director application" },
  { value: "scholarship", label: "Scholarship application" },
  { value: "mentorship", label: "Mentorship application" },
  { value: "student_program", label: "Student program" },
  { value: "adjudicator", label: "Adjudicator application" },
  { value: "other", label: "Other" },
];

function typeLabel(value: ProgramType) {
  return PROGRAM_TYPES.find((item) => item.value === value)?.label ?? value;
}

export default async function CyclesPage() {
  const profile = await requireProfile(["advisory_member", "owner"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("award_cycles")
    .select(
      "id,cycle_key,name,season_year,program_type,description,status,opens_at,closes_at,is_active,cloned_from_cycle_id,created_at,updated_at",
    )
    .order("season_year", { ascending: false })
    .order("name");

  const cycles = (data ?? []) as AwardCycle[];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Programs &amp; cycles</h1>
          <p>
            Director, scholarship, mentorship, and other applications can be
            open at the same time.
          </p>
        </div>
      </div>

      <div className="split-grid">
        <section className="panel">
          <div className="panel-header"><h2>Configured programs</h2></div>
          <div className="panel-body form-stack">
            {error ? (
              <div className="form-error">{error.message}</div>
            ) : cycles.length === 0 ? (
              <p>No application programs configured.</p>
            ) : (
              cycles.map((cycle) => (
                <article className="detail-item cycle-card" key={cycle.id}>
                  <div className="cycle-card-heading">
                    <div>
                      <span>{cycle.season_year} · {typeLabel(cycle.program_type)}</span>
                      <strong>{cycle.name}</strong>
                      <small>{cycle.cycle_key}</small>
                    </div>
                    <div className="heading-actions">
                      <span className={`badge badge-form-${cycle.status}`}>{cycle.status}</span>
                      {cycle.is_active && <span className="badge badge-complete">Accepting applications</span>}
                    </div>
                  </div>

                  {cycle.description && <p>{cycle.description}</p>}

                  {profile.role === "owner" && (
                    <div className="cycle-actions">
                      {cycle.is_active ? (
                        <form action={deactivateCycle.bind(null, cycle.id)}>
                          <button className="button button-secondary button-compact" type="submit">
                            Close applications
                          </button>
                        </form>
                      ) : cycle.status !== "archived" ? (
                        <form action={activateCycle.bind(null, cycle.id)}>
                          <button className="button button-dark button-compact" type="submit">
                            Open applications
                          </button>
                        </form>
                      ) : null}

                      <details>
                        <summary>Duplicate program and form</summary>
                        <form action={duplicateCycle.bind(null, cycle.id)} className="form-stack compact-form">
                          <div className="field">
                            <label>New program name</label>
                            <input className="input" name="name" defaultValue={cycle.name.replace(cycle.season_year, "")} required />
                          </div>
                          <div className="field">
                            <label>New season year</label>
                            <input className="input" name="season_year" placeholder="2026-2027" required />
                          </div>
                          <div className="field">
                            <label>New cycle key</label>
                            <input className="input" name="cycle_key" placeholder="2026-2027-directors" required />
                          </div>
                          <div className="field">
                            <label>Program type</label>
                            <select className="select" name="program_type" defaultValue={cycle.program_type}>
                              {PROGRAM_TYPES.map((type) => (
                                <option key={type.value} value={type.value}>{type.label}</option>
                              ))}
                            </select>
                          </div>
                          <button className="button button-dark button-compact" type="submit">Duplicate</button>
                        </form>
                      </details>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        </section>

        {profile.role === "owner" && (
          <section className="panel">
            <div className="panel-header"><h2>Create program</h2></div>
            <div className="panel-body">
              <form action={createCycle} className="form-stack">
                <div className="field">
                  <label htmlFor="name">Program name</label>
                  <input className="input" id="name" name="name" placeholder="2026–2027 Director Application" required />
                </div>
                <div className="field">
                  <label htmlFor="season_year">Season year</label>
                  <input className="input" id="season_year" name="season_year" placeholder="2026-2027" required />
                </div>
                <div className="field">
                  <label htmlFor="program_type">Program type</label>
                  <select className="select" id="program_type" name="program_type" defaultValue="directors">
                    {PROGRAM_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="cycle_key">Cycle key</label>
                  <input className="input" id="cycle_key" name="cycle_key" placeholder="Generated automatically when blank" />
                </div>
                <div className="field">
                  <label htmlFor="description">Description</label>
                  <textarea className="textarea" id="description" name="description" />
                </div>
                <div className="field">
                  <label htmlFor="opens_at">Opens</label>
                  <input className="input" id="opens_at" name="opens_at" type="datetime-local" />
                </div>
                <div className="field">
                  <label htmlFor="closes_at">Closes</label>
                  <input className="input" id="closes_at" name="closes_at" type="datetime-local" />
                </div>
                <label className="check-row">
                  <input name="open_immediately" type="checkbox" />
                  Open this program immediately
                </label>
                <button className="button button-dark" type="submit">Create program</button>
              </form>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
