import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  AdjudicationScorecard,
  AdjudicatorAssignment,
  Application,
  AwardCycle,
} from "@/lib/types";

export default async function AdjudicationDashboard() {
  const profile = await requireProfile(["adjudicator", "advisory_member", "owner"]);
  const supabase = await createClient();

  const cyclesResult = await supabase.from("award_cycles").select("*");
  const cycles = (cyclesResult.data ?? []) as AwardCycle[];
  const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));

  let applications: Application[] = [];
  let assignments: AdjudicatorAssignment[] = [];

  if (profile.role === "adjudicator") {
    const { data: assignmentData, error: assignmentError } = await supabase
      .from("adjudicator_assignments")
      .select("*")
      .eq("adjudicator_user_id", profile.id)
      .order("assigned_at", { ascending: false });
    if (assignmentError) throw new Error(assignmentError.message);
    assignments = (assignmentData ?? []) as AdjudicatorAssignment[];

    const applicationIds = assignments.map((assignment) => assignment.application_id);
    if (applicationIds.length > 0) {
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .in("id", applicationIds)
        .order("school_name");
      if (error) throw new Error(error.message);
      applications = (data ?? []) as Application[];
    }
  } else {
    const [{ data: applicationData, error: applicationError }, { data: assignmentData, error: assignmentError }] = await Promise.all([
      supabase
        .from("applications")
        .select("*")
        .eq("is_archived", false)
        .in("status", ["submitted", "under_review", "complete"])
        .order("school_name"),
      supabase.from("adjudicator_assignments").select("*").order("assigned_at", { ascending: false }),
    ]);
    if (applicationError) throw new Error(applicationError.message);
    if (assignmentError) throw new Error(assignmentError.message);
    applications = (applicationData ?? []) as Application[];
    assignments = (assignmentData ?? []) as AdjudicatorAssignment[];
  }

  const applicationIds = applications.map((application) => application.id);
  const { data: scorecardData, error: scorecardError } = applicationIds.length
    ? await supabase.from("adjudication_scorecards").select("*").in("application_id", applicationIds)
    : { data: [], error: null };
  if (scorecardError) throw new Error(scorecardError.message);
  const scorecards = (scorecardData ?? []) as AdjudicationScorecard[];

  const applicationMap = new Map(applications.map((application) => [application.id, application]));
  const relevantRows = profile.role === "adjudicator"
    ? assignments.map((assignment) => ({ assignment, application: applicationMap.get(assignment.application_id) })).filter((row) => row.application)
    : applications.map((application) => ({
      application,
      assignments: assignments.filter((assignment) => assignment.application_id === application.id),
    }));

  const submittedCards = scorecards.filter((card) => card.status === "submitted" || card.status === "locked").length;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{profile.role === "adjudicator" ? "My adjudication assignments" : "Adjudication review"}</h1>
          <p>{profile.role === "adjudicator" ? "Score assigned productions and complete all four comment quadrants before submitting." : "Review panel scorecards, synthesize comments, and prepare owner-controlled school releases."}</p>
        </div>
        {profile.role === "owner" && <Link className="button button-dark" href="/portal/admin/scoring">Scoring setup</Link>}
      </div>

      <section className="metric-grid" aria-label="Adjudication overview">
        <article className="metric-card"><span className="metric-label">Productions</span><strong className="metric-value">{applications.length}</strong></article>
        <article className="metric-card"><span className="metric-label">Assignments</span><strong className="metric-value">{assignments.length}</strong></article>
        <article className="metric-card"><span className="metric-label">Submitted scorecards</span><strong className="metric-value">{submittedCards}</strong></article>
        <article className="metric-card"><span className="metric-label">Pending</span><strong className="metric-value">{Math.max(assignments.length - submittedCards, 0)}</strong></article>
      </section>

      <section className="panel">
        <div className="panel-header"><h2>{profile.role === "adjudicator" ? "Assigned productions" : "Productions under review"}</h2></div>
        <div className="adjudication-card-list">
          {profile.role === "adjudicator" ? (
            relevantRows.map((row) => {
              if (!("assignment" in row) || !row.application) return null;
              const cycle = cycleMap.get(row.application.cycle_id);
              const card = scorecards.find((item) => item.assignment_id === row.assignment.id);
              const status = card?.status ?? row.assignment.status;
              return (
                <Link className="adjudication-card" href={`/portal/adjudication/${row.application.id}`} key={row.assignment.id}>
                  <div>
                    <span className="eyebrow">{cycle ? `${cycle.season_year} · ${cycle.name}` : "Assigned production"}</span>
                    <h3>{row.application.school_name}</h3>
                    <p>{row.application.production_title ?? "Untitled production"}</p>
                  </div>
                  <div className="adjudication-card-meta">
                    <span className={`badge badge-scorecard-${status}`}>{status.replaceAll("_", " ")}</span>
                    <small>{row.assignment.due_at ? `Due ${new Date(row.assignment.due_at).toLocaleDateString()}` : "No due date"}</small>
                  </div>
                </Link>
              );
            })
          ) : (
            relevantRows.map((row) => {
              if (!("assignments" in row)) return null;
              const cycle = cycleMap.get(row.application.cycle_id);
              const cards = scorecards.filter((card) => card.application_id === row.application.id);
              const complete = cards.filter((card) => card.status === "submitted" || card.status === "locked").length;
              return (
                <Link className="adjudication-card" href={`/portal/adjudication/${row.application.id}`} key={row.application.id}>
                  <div>
                    <span className="eyebrow">{cycle ? `${cycle.season_year} · ${cycle.name}` : "Production"}</span>
                    <h3>{row.application.school_name}</h3>
                    <p>{row.application.production_title ?? "Untitled production"}</p>
                  </div>
                  <div className="adjudication-card-meta">
                    <strong>{complete} / {row.assignments.length}</strong>
                    <small>scorecards submitted</small>
                  </div>
                </Link>
              );
            })
          )}
          {relevantRows.length === 0 && (
            <div className="empty-state"><h3>No adjudication work is available yet.</h3><p>{profile.role === "adjudicator" ? "An owner must assign a production to you." : "Submitted applications will appear here once adjudicators are assigned."}</p></div>
          )}
        </div>
      </section>
    </>
  );
}
