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

  const cyclesResult = await supabase
    .from("award_cycles")
    .select("*")
    .eq("is_active", true)
    .neq("status", "archived");
  const cycles = (cyclesResult.data ?? []) as AwardCycle[];
  const activeCycleIds = cycles.map((cycle) => cycle.id);
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
    const candidateAssignments = (assignmentData ?? []) as AdjudicatorAssignment[];

    const applicationIds = candidateAssignments.map(
      (assignment) => assignment.application_id,
    );
    if (applicationIds.length > 0 && activeCycleIds.length > 0) {
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .in("id", applicationIds)
        .in("cycle_id", activeCycleIds)
        .eq("is_archived", false)
        .order("school_name");
      if (error) throw new Error(error.message);
      applications = (data ?? []) as Application[];
    }

    const activeApplicationIds = new Set(
      applications.map((application) => application.id),
    );
    assignments = candidateAssignments.filter((assignment) =>
      activeApplicationIds.has(assignment.application_id),
    );
  } else if (activeCycleIds.length > 0) {
    const [{ data: applicationData, error: applicationError }, { data: assignmentData, error: assignmentError }] = await Promise.all([
      supabase
        .from("applications")
        .select("*")
        .in("cycle_id", activeCycleIds)
        .eq("is_archived", false)
        .in("status", ["submitted", "under_review", "complete"])
        .order("school_name"),
      supabase.from("adjudicator_assignments").select("*").order("assigned_at", { ascending: false }),
    ]);
    if (applicationError) throw new Error(applicationError.message);
    if (assignmentError) throw new Error(assignmentError.message);
    applications = (applicationData ?? []) as Application[];
    const activeApplicationIds = new Set(
      applications.map((application) => application.id),
    );
    assignments = ((assignmentData ?? []) as AdjudicatorAssignment[]).filter(
      (assignment) => activeApplicationIds.has(assignment.application_id),
    );
  }

  const applicationIds = applications.map((application) => application.id);

  const advisoryReviewAccessResult =
    profile.role === "advisory_member"
      ? await supabase.rpc("get_advisory_review_application_ids")
      : { data: [], error: null };

  if (advisoryReviewAccessResult.error) {
    throw new Error(advisoryReviewAccessResult.error.message);
  }

  const advisoryReviewApplicationIds = new Set(
    (advisoryReviewAccessResult.data ?? []).map(
      (row: { application_id: string }) => row.application_id,
    ),
  );

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

  let advisoryQueue: Array<{
    application: Application;
    unresolved: number;
    disputed: number;
    submitted: number;
    assigned: number;
    reviewStatus: string;
  }> = [];

  if (profile.role === "advisory_member" && applicationIds.length > 0) {
    const [{ data: proposals }, { data: reviews }] = await Promise.all([
      supabase
        .from("adjudication_category_proposals")
        .select("application_id,status")
        .in("application_id", applicationIds),
      supabase
        .from("adjudication_reviews")
        .select("application_id,status")
        .in("application_id", applicationIds),
    ]);
    const reviewMap = new Map((reviews ?? []).map((review) => [review.application_id, review.status]));
    advisoryQueue = applications
      .filter((application) =>
        advisoryReviewApplicationIds.has(application.id),
      )
      .map((application) => {
      const applicationProposals = (proposals ?? []).filter((proposal) => proposal.application_id === application.id);
      const applicationAssignments = assignments.filter((assignment) => assignment.application_id === application.id);
      const applicationCards = scorecards.filter((card) => card.application_id === application.id);
      return {
        application,
        unresolved: Math.max(15 - applicationProposals.filter((proposal) => ["approved", "overridden"].includes(proposal.status)).length, 0),
        disputed: applicationProposals.filter((proposal) => proposal.status === "disputed").length,
        submitted: applicationCards.filter((card) => ["submitted", "locked"].includes(card.status)).length,
        assigned: applicationAssignments.length,
        reviewStatus: reviewMap.get(application.id) ?? "draft",
      };
    }).sort((left, right) => {
      const leftUrgency = left.disputed * 100 + left.unresolved * 10 + Math.max(left.assigned - left.submitted, 0);
      const rightUrgency = right.disputed * 100 + right.unresolved * 10 + Math.max(right.assigned - right.submitted, 0);
      return rightUrgency - leftUrgency || left.application.school_name.localeCompare(right.application.school_name);
    });
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{profile.role === "adjudicator" ? "My adjudication assignments" : "Adjudication review"}</h1>
          <p>{profile.role === "adjudicator" ? "Score assigned productions and complete all four comment quadrants before submitting." : "Review panel scorecards, synthesize comments, and prepare owner-controlled school releases."}</p>
        </div>
        {profile.role === "owner" && (
          <div className="heading-actions">
            <Link className="button button-secondary" href="/portal/admin/archive#assignment-archive">View archive</Link>
            <Link className="button button-dark" href="/portal/admin/scoring">Scoring setup</Link>
          </div>
        )}
      </div>

      <section className="metric-grid" aria-label="Adjudication overview">
        <article className="metric-card"><span className="metric-label">Productions</span><strong className="metric-value">{applications.length}</strong></article>
        <article className="metric-card"><span className="metric-label">Assignments</span><strong className="metric-value">{assignments.length}</strong></article>
        <article className="metric-card"><span className="metric-label">Submitted scorecards</span><strong className="metric-value">{submittedCards}</strong></article>
        <article className="metric-card"><span className="metric-label">Pending</span><strong className="metric-value">{Math.max(assignments.length - submittedCards, 0)}</strong></article>
      </section>


      {profile.role === "advisory_member" && (
        <>
          <section className="advisory-dashboard-metrics metric-grid" aria-label="Advisory Committee queue">
            <article className="metric-card"><span className="metric-label">Schools in review</span><strong className="metric-value">{advisoryQueue.length}</strong></article>
            <article className="metric-card"><span className="metric-label">Disputed decisions</span><strong className="metric-value">{advisoryQueue.reduce((total, row) => total + row.disputed, 0)}</strong></article>
            <article className="metric-card"><span className="metric-label">Unresolved categories</span><strong className="metric-value">{advisoryQueue.reduce((total, row) => total + row.unresolved, 0)}</strong></article>
            <article className="metric-card"><span className="metric-label">Missing scorecards</span><strong className="metric-value">{advisoryQueue.reduce((total, row) => total + Math.max(row.assigned - row.submitted, 0), 0)}</strong></article>
          </section>
          <section className="panel advisory-review-queue">
            <div className="panel-header"><div><h2>Advisory Committee review queue</h2><p>Schools are sorted by disputes, unresolved eligibility/ranges, and missing scorecards.</p></div></div>
            <div className="advisory-queue-grid">
              {advisoryQueue.map((row) => {
                const cycle = cycleMap.get(row.application.cycle_id);
                return <Link className="advisory-queue-card" href={`/portal/adjudication/${row.application.id}`} key={row.application.id}><div><span className="eyebrow">{cycle ? `${cycle.season_year} · ${cycle.name}` : "Adjudication"}</span><h3>{row.application.school_name}</h3><p>{row.application.production_title ?? "Untitled production"}</p></div><div className="advisory-queue-status-grid"><span><strong>{row.unresolved}</strong> unresolved</span><span className={row.disputed ? "is-alert" : ""}><strong>{row.disputed}</strong> disputed</span><span><strong>{row.submitted}/{row.assigned}</strong> scorecards</span><span><strong>{row.reviewStatus.replaceAll("_", " ")}</strong></span></div></Link>;
              })}
            </div>
          </section>
        </>
      )}
      <section className="panel">
        <div className="panel-header"><div><h2>{profile.role === "adjudicator" ? "Assigned productions" : profile.role === "advisory_member" ? "All active applications" : "Productions under review"}</h2>{profile.role === "advisory_member" && <p>Every active application is available to read. Review tools activate only for schools whose timeslot you selected or were assigned.</p>}</div></div>
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
                    {profile.role === "advisory_member" && (
                      <span
                        className={`badge ${
                          advisoryReviewApplicationIds.has(row.application.id)
                            ? "badge-submitted"
                            : "badge-draft"
                        }`}
                      >
                        {advisoryReviewApplicationIds.has(row.application.id)
                          ? "Review enabled"
                          : "Application access"}
                      </span>
                    )}
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
