import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createCycle, activateCycle } from "./actions";

export default async function CyclesPage() {
  const profile = await requireProfile(["advisory_member", "owner"]);
  const supabase = await createClient();
  const { data: cycles } = await supabase.from("award_cycles").select("*").order("created_at", { ascending: false });

  return (
    <>
      <div className="page-heading"><div><h1>Awards cycles</h1><p>Preserve each season independently and designate one active application cycle.</p></div></div>
      <div className="split-grid">
        <section className="panel"><div className="panel-header"><h2>Configured cycles</h2></div><div className="panel-body form-stack">
          {(cycles ?? []).length === 0 ? <p>No cycles configured.</p> : (cycles ?? []).map((cycle) => (
            <div className="detail-item" key={cycle.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <div><span>{cycle.season_year}</span><strong>{cycle.name}</strong>{cycle.is_active && <div><span className="badge badge-complete">Active</span></div>}</div>
              {profile.role === "owner" && !cycle.is_active && <form action={activateCycle.bind(null, cycle.id)}><button className="button button-dark button-compact" type="submit">Activate</button></form>}
            </div>
          ))}
        </div></section>
        {profile.role === "owner" && <section className="panel"><div className="panel-header"><h2>Create cycle</h2></div><div className="panel-body"><form action={createCycle} className="form-stack">
          <div className="field"><label htmlFor="name">Cycle name</label><input className="input" id="name" name="name" placeholder="2026–2027 Awards Cycle" required /></div>
          <div className="field"><label htmlFor="season_year">Season year</label><input className="input" id="season_year" name="season_year" placeholder="2026-2027" required /></div>
          <div className="field"><label htmlFor="opens_at">Opens</label><input className="input" id="opens_at" name="opens_at" type="datetime-local" /></div>
          <div className="field"><label htmlFor="closes_at">Closes</label><input className="input" id="closes_at" name="closes_at" type="datetime-local" /></div>
          <button className="button button-dark" type="submit">Create cycle</button>
        </form></div></section>}
      </div>
    </>
  );
}
