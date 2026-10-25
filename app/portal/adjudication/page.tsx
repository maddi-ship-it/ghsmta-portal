import Link from "next/link";

import { AdjudicationReferenceLinks } from "@/components/adjudication-reference-links";
import { loadAdjudicationReferenceLinks } from "@/lib/adjudication-reference-documents";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AdjudicationScorecard,
  AdjudicatorAssignment,
  Application,
  AwardCycle,
} from "@/lib/types";

type AdjudicationSearchParams = {
  completed?: string;
  q?: string;
};

type ScheduleBookingReference = {
  slot_id: string;
  application_id: string;
};

type ScheduleStaffReference = {
  slot_id: string;
  user_id: string;
  participation_mode: "panel" | "understudy" | "shadow";
};

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase();
}

export default async function AdjudicationDashboard({
  searchParams,
}: {
  searchParams: Promise<AdjudicationSearchParams>;
}) {
  const profile = await requireProfile(["adjudicator", "advisory_member", "owner"]);
  const params = await searchParams;
  const searchQuery = String(params.q ?? "").trim();
  const normalizedSearchQuery = normalizeSearch(searchQuery);
  const supabase = await createClient();
  const admin = createAdminClient();
  const referenceLinksPromise = loadAdjudicationReferenceLinks(supabase);

  const cyclesResult = await supabase
    .from("award_cycles")
    .select("*")
    .neq("status", "archived");
  if (cyclesResult.error) throw new Error(cyclesResult.error.message);
  const cycles = (cyclesResult.data ?? []) as AwardCycle[];
  const adjudicationCycleIds = cycles.map((cycle) => cycle.id);
  const cycleMap = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const [scheduleBookingsResult, scheduleStaffResult] = await Promise.all([
    supabase.rpc("get_schedule_bookings_for_staff"),
    supabase.rpc("get_schedule_staff_directory"),
  ]);
  if (scheduleBookingsResult.error) {
    throw new Error(scheduleBookingsResult.error.message);
  }
  if (scheduleStaffResult.error) {
    throw new Error(scheduleStaffResult.error.message);
  }
  const shadowSlotIds = new Set(
    ((scheduleStaffResult.data ?? []) as ScheduleStaffReference[])
      .filter(
        (staff) =>
          staff.user_id === profile.id &&
          staff.participation_mode === "shadow",
      )
      .map((staff) => staff.slot_id),
  );
  const scheduledShadowApplicationIds = new Set(
    ((scheduleBookingsResult.data ?? []) as ScheduleBookingReference[])
      .filter((booking) => shadowSlotIds.has(booking.slot_id))
      .map((booking) => booking.application_id),
  );

  let applications: Application[] = [];
  let assignments: AdjudicatorAssignment[] = [];

  if (profile.role === "adjudicator") {
    const { data: assignmentData, error: assignmentError } = await supabase
      .from("adjudicator_assignments")
      .select("*")
      .eq("adjudicator_user_id", profile.id)
      .is("removed_at", null)
      .order("assigned_at", { ascending: false });
    if (assignmentError) throw new Error(assignmentError.message);
    const candidateAssignments = (assignmentData ?? []) as AdjudicatorAssignment[];

    const applicationIds = [
      ...new Set([
        ...candidateAssignments.map(
          (assignment) => assignment.application_id,
        ),
        ...scheduledShadowApplicationIds,
      ]),
    ];
    if (applicationIds.length > 0 && adjudicationCycleIds.length > 0) {
      const { data, error } = await admin
        .from("applications")
        .select("*")
        .in("id", applicationIds)
        .in("cycle_id", adjudicationCycleIds)
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
  } else if (adjudicationCycleIds.length > 0) {
    const [{ data: applicationData, error: applicationError }, { data: assignmentData, error: assignmentError }] = await Promise.all([
      supabase
        .from("applications")
        .select("*")
        .in("cycle_id", adjudicationCycleIds)
        .eq("is_archived", false)
        .order("school_name"),
      supabase.from("adjudicator_assignments").select("*").order("assigned_at", { ascending: false }),
    ]);
    if (applicationError) throw new Error(applicationError.message);
    if (assignmentError) throw new Error(assignmentError.message);
    const currentAssignments = (
      (assignmentData ?? []) as AdjudicatorAssignment[]
    ).filter((assignment) => !assignment.removed_at);
    const assignedApplicationIds = new Set(
      currentAssignments.map((assignment) => assignment.application_id),
    );
    const reviewableStatuses = new Set(["submitted", "under_review", "complete"]);
    applications = ((applicationData ?? []) as Application[]).filter(
      (application) =>
        profile.role === "advisory_member" ||
        reviewableStatuses.has(application.status) ||
        assignedApplicationIds.has(application.id),
    );
    const activeApplicationIds = new Set(
      applications.map((application) => application.id),
    );
    assignments = currentAssignments.filter(
      (assignment) => activeApplicationIds.has(assignment.application_id),
    );
  }

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
  const readOnlyObserverApplicationIds = new Set(
    scheduledShadowApplicationIds,
  );
  for (const assignment of assignments) {
    if (
      assignment.adjudicator_user_id === profile.id &&
      !assignment.can_score &&
      !assignment.can_comment
    ) {
      readOnlyObserverApplicationIds.add(assignment.application_id);
    }
  }

  if (profile.role === "advisory_member") {
    applications = applications.filter(
      (application) =>
        advisoryReviewApplicationIds.has(application.id) ||
        readOnlyObserverApplicationIds.has(application.id),
    );
    const visibleApplicationIds = new Set(
      applications.map((application) => application.id),
    );
    assignments = assignments.filter((assignment) =>
      visibleApplicationIds.has(assignment.application_id),
    );
  }

  const applicationIds = applications.map((application) => application.id);

  const { data: scorecardData, error: scorecardError } = applicationIds.length
    ? await supabase.from("adjudication_scorecards").select("*").in("application_id", applicationIds)
    : { data: [], error: null };
  if (scorecardError) throw new Error(scorecardError.message);
  const scorecards = (scorecardData ?? []) as AdjudicationScorecard[];
  const assignmentByApplicationId = new Map(
    assignments
      .filter((assignment) => assignment.adjudicator_user_id === profile.id)
      .map((assignment) => [assignment.application_id, assignment]),
  );
  const assignmentsByApplicationId = new Map<
    string,
    AdjudicatorAssignment[]
  >();
  for (const assignment of assignments) {
    const applicationAssignments =
      assignmentsByApplicationId.get(assignment.application_id) ?? [];
    applicationAssignments.push(assignment);
    assignmentsByApplicationId.set(
      assignment.application_id,
      applicationAssignments,
    );
  }

  const relevantRows = profile.role === "adjudicator"
    ? applications.map((application) => ({
        assignment: assignmentByApplicationId.get(application.id) ?? null,
        application,
        isReadOnlyObserver: readOnlyObserverApplicationIds.has(application.id),
      }))
    : applications.map((application) => ({
      application,
      assignments: assignmentsByApplicationId.get(application.id) ?? [],
      isReadOnlyObserver: readOnlyObserverApplicationIds.has(application.id),
    }));

  const actionableAssignments = assignments.filter(
    (assignment) =>
      !readOnlyObserverApplicationIds.has(assignment.application_id) &&
      Boolean(assignment.can_score || assignment.can_comment),
  );
  const submittedCards = scorecards.filter(
    (card) =>
      !readOnlyObserverApplicationIds.has(card.application_id) &&
      (card.status === "submitted" || card.status === "locked"),
  ).length;

  const matchesSearch = (application: Application | undefined) => {
    if (!application) return false;
    if (!normalizedSearchQuery) return true;

    const cycle = cycleMap.get(application.cycle_id);
    return normalizeSearch([
      application.school_name,
      application.production_title ?? "",
      cycle?.season_year ?? "",
      cycle?.name ?? "",
    ].join(" ")).includes(normalizedSearchQuery);
  };

  const visibleRows = relevantRows.filter((row) =>
    matchesSearch(row.application),
  );

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
        advisoryReviewApplicationIds.has(application.id) &&
        !readOnlyObserverApplicationIds.has(application.id),
      )
      .map((application) => {
      const applicationProposals = (proposals ?? []).filter((proposal) => proposal.application_id === application.id);
      const applicationAssignments =
        assignmentsByApplicationId.get(application.id) ?? [];
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

  const visibleAdvisoryQueue = advisoryQueue.filter((row) =>
    matchesSearch(row.application),
  );
  const referenceLinks = await referenceLinksPromise;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{profile.role === "adjudicator" ? "My adjudication assignments" : profile.role === "advisory_member" ? "My adjudication schools" : "Adjudication review"}</h1>
          <p>{profile.role === "adjudicator" ? "Score assigned productions and complete all four comment quadrants before submitting." : profile.role === "advisory_member" ? "Review the schools whose timeslots you joined or were assigned to." : "Review panel scorecards, synthesize comments, and prepare owner-controlled school releases."}</p>
        </div>
        {profile.role === "owner" && (
          <div className="heading-actions">
            <Link className="button button-secondary" href="/portal/admin/archive#assignment-archive">View archive</Link>
            <Link className="button button-dark" href="/portal/admin/scoring">Scoring setup</Link>
          </div>
        )}
      </div>

      <AdjudicationReferenceLinks links={referenceLinks} />

      {params.completed && (
        <div className="notice page-message">
          Adjudication completed. Your access to that school has been removed.
        </div>
      )}

      <section className="metric-grid" aria-label="Adjudication overview">
        <article className="metric-card"><span className="metric-label">Productions</span><strong className="metric-value">{applications.length}</strong></article>
        <article className="metric-card"><span className="metric-label">Assignments</span><strong className="metric-value">{relevantRows.length}</strong></article>
        <article className="metric-card"><span className="metric-label">Submitted scorecards</span><strong className="metric-value">{submittedCards}</strong></article>
        <article className="metric-card"><span className="metric-label">Pending</span><strong className="metric-value">{Math.max(actionableAssignments.length - submittedCards, 0)}</strong></article>
      </section>

      <section className="panel adjudication-search-panel">
        <form action="/portal/adjudication" className="panel-body adjudication-search-form" method="get">
          <div className="field adjudication-search-field">
            <label htmlFor="adjudication_search">Search adjudication applications</label>
            <div className="adjudication-search-row">
              <input
                className="input"
                defaultValue={searchQuery}
                id="adjudication_search"
                name="q"
                placeholder="Search school, production, season, or program"
                type="search"
              />
              <button className="button button-dark" type="submit">Search</button>
              {searchQuery && <Link className="button button-secondary" href="/portal/adjudication">Clear</Link>}
            </div>
            <small className="field-help" aria-live="polite">
              {searchQuery
                ? `Showing ${visibleRows.length} of ${relevantRows.length} available productions.`
                : `${relevantRows.length} productions are available.`}
            </small>
          </div>
        </form>
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
              {visibleAdvisoryQueue.map((row) => {
                const cycle = cycleMap.get(row.application.cycle_id);
                return <Link className="advisory-queue-card" href={`/portal/adjudication/${row.application.id}`} key={row.application.id}><div><span className="eyebrow">{cycle ? `${cycle.season_year} · ${cycle.name}` : "Adjudication"}</span><h3>{row.application.school_name}</h3><p>{row.application.production_title ?? "Untitled production"}</p></div><div className="advisory-queue-status-grid"><span><strong>{row.unresolved}</strong> unresolved</span><span className={row.disputed ? "is-alert" : ""}><strong>{row.disputed}</strong> disputed</span><span><strong>{row.submitted}/{row.assigned}</strong> scorecards</span><span><strong>{row.reviewStatus.replaceAll("_", " ")}</strong></span></div></Link>;
              })}
              {visibleAdvisoryQueue.length === 0 && searchQuery && (
                <div className="empty-state"><h3>No review schools match that search.</h3><p>Try another school, production, season, or program name.</p></div>
              )}
            </div>
          </section>
        </>
      )}
      <section className="panel">
        <div className="panel-header"><div><h2>{profile.role === "adjudicator" ? "Assigned productions" : profile.role === "advisory_member" ? "My signed-on schools" : "Productions under review"}</h2>{profile.role === "advisory_member" && <p>Schools appear here after you join their timeslot or an Owner assigns you.</p>}</div></div>
        <div className="adjudication-card-list">
          {profile.role === "adjudicator" ? (
            visibleRows.map((row) => {
              if (!("assignment" in row) || !row.application) return null;
              const cycle = cycleMap.get(row.application.cycle_id);
              const card = row.assignment
                ? scorecards.find(
                    (item) => item.assignment_id === row.assignment?.id,
                  )
                : null;
              const status = row.isReadOnlyObserver
                ? "shadow"
                : card?.status ?? row.assignment?.status ?? "assigned";
              return (
                <Link className="adjudication-card" href={`/portal/adjudication/${row.application.id}`} key={row.assignment?.id ?? `shadow-${row.application.id}`}>
                  <div>
                    <span className="eyebrow">{cycle ? `${cycle.season_year} · ${cycle.name}` : "Assigned production"}</span>
                    <h3>{row.application.school_name}</h3>
                    <p>{row.application.production_title ?? "Untitled production"}</p>
                  </div>
                  <div className="adjudication-card-meta">
                    <span className={`badge badge-scorecard-${status}`}>
                      {row.isReadOnlyObserver
                        ? "Shadow · read only"
                        : status.replaceAll("_", " ")}
                    </span>
                    <small>{row.isReadOnlyObserver ? "View panel adjudication" : row.assignment?.due_at ? `Due ${new Date(row.assignment.due_at).toLocaleDateString()}` : "No due date"}</small>
                  </div>
                </Link>
              );
            })
          ) : (
            visibleRows.map((row) => {
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
                          row.isReadOnlyObserver
                            ? "badge-draft"
                            : advisoryReviewApplicationIds.has(row.application.id)
                            ? "badge-submitted"
                            : "badge-draft"
                        }`}
                      >
                        {row.isReadOnlyObserver
                          ? "Shadow · read only"
                          : "Review enabled"}
                      </span>
                    )}
                    <strong>{complete} / {row.assignments.length}</strong>
                    <small>scorecards submitted</small>
                  </div>
                </Link>
              );
            })
          )}
          {visibleRows.length === 0 && (
            <div className="empty-state">
              <h3>{searchQuery ? "No productions match that search." : "No adjudication work is available yet."}</h3>
              <p>{searchQuery ? "Try another school, production, season, or program name." : profile.role === "adjudicator" ? "An owner must assign a production to you." : profile.role === "advisory_member" ? "Join a school timeslot in Scheduling, or ask an Owner to assign you." : "Submitted applications will appear here once adjudicators are assigned."}</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
