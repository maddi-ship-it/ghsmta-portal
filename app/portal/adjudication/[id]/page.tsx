import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatScore,
  quarterScoreOptions,
} from "@/lib/adjudication";
import { resolveScoringCategorySubjects } from "@/lib/application-scoring-subjects";
import {
  buildApplicationReferencePanels,
  type ApplicationReferencePanel,
} from "@/lib/application-reference-panels";
import { AdjudicatorAutosave } from "@/components/adjudicator-autosave";
import { ApplicationReferenceBar } from "@/components/application-reference-bar";
import { CollaborativeAdjudicatorScorecard } from "@/components/collaborative-adjudicator-scorecard";
import { OwnerLiveAdjudicationReview } from "@/components/owner-live-adjudication-review";
import { ScorecardSubmitControls } from "@/components/scorecard-submit-controls";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  AdjudicationCategoryComment,
  AdjudicationPanelFeedback,
  AdjudicationRelease,
  AdjudicationScore,
  AdjudicationScorecard,
  AdjudicatorAssignment,
  Application,
  ApplicationAnswer,
  ApplicationQuestion,
  AwardCycle,
  Profile,
  ScoringCategory,
  ScoringCriterion,
  ScoringRubric,
  ScoringScaleLevel,
} from "@/lib/types";

import {
  releaseAdjudicationResults,
  saveAdjudicatorScorecard,
} from "./actions";


type ScheduleBookingReference = {
  slot_id: string;
  application_id: string;
  school_name: string;
  production_title: string | null;
  booked_at: string;
};

type ScheduleStaffReference = {
  slot_id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
};

type ScheduleSlotReference = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  school_instructions: string | null;
  status: string;
};

const EASTERN_TIME_ZONE = "America/New_York";

function formatReferenceDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatReferenceTime(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });

  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))} ET`;
}

function scorecardStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export default async function AdjudicationApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    submitted?: string;
    generated?: string;
    released?: string;
    error?: string;
    missing?: string;
  }>;
}) {
  const profile = await requireProfile(["adjudicator", "advisory_member", "owner"]);
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const { data: applicationData, error: applicationError } = await supabase
    .from("applications")
    .select("*")
    .eq("id", id)
    .single();
  if (applicationError || !applicationData) notFound();
  const application = applicationData as Application;

  const [applicationQuestionsResult, applicationAnswersResult] =
    application.form_version_id
      ? await Promise.all([
          supabase
            .from("application_questions")
            .select(
              "id,form_version_id,section_id,question_key,label,description,question_type,required,options,settings,visibility_rule,sort_order,active,source_column_index,source_label,imported,created_at,updated_at",
            )
            .eq("form_version_id", application.form_version_id),
          supabase
            .from("application_answers")
            .select("id,application_id,question_id,value,updated_at")
            .eq("application_id", id),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];

  if (applicationQuestionsResult.error) {
    throw new Error(applicationQuestionsResult.error.message);
  }

  if (applicationAnswersResult.error) {
    throw new Error(applicationAnswersResult.error.message);
  }

  const applicationQuestions =
    (applicationQuestionsResult.data ?? []) as ApplicationQuestion[];
  const applicationAnswers =
    (applicationAnswersResult.data ?? []) as ApplicationAnswer[];

  const categorySubjectDefaults = resolveScoringCategorySubjects({
    application,
    questions: applicationQuestions,
    answers: applicationAnswers,
  });

  const applicationReferencePanels = buildApplicationReferencePanels({
    application,
    questions: applicationQuestions,
    answers: applicationAnswers,
  });

  const { data: cycleData } = await supabase.from("award_cycles").select("*").eq("id", application.cycle_id).single();
  const cycle = cycleData as AwardCycle | null;

  const { data: rubricData, error: rubricError } = await supabase
    .from("scoring_rubrics")
    .select("*")
    .eq("cycle_id", application.cycle_id)
    .eq("status", "published")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rubricError) throw new Error(rubricError.message);
  const rubric = rubricData as ScoringRubric | null;

  if (!rubric) {
    return (
      <>
        <div className="page-heading"><div><h1>{application.school_name}</h1><p>{application.production_title ?? "Untitled production"}</p></div></div>
        <section className="panel"><div className="empty-state"><h3>No published scoring rubric</h3><p>An owner must seed or publish a rubric for this program before adjudication can begin.</p>{profile.role === "owner" && <Link className="button button-dark" href="/portal/admin/scoring">Open scoring setup</Link>}</div></section>
      </>
    );
  }

  const [
    categoriesResult,
    scaleResult,
    assignmentsResult,
    scorecardsResult,
    feedbackResult,
    releaseResult,
    scheduleBookingsResult,
    scheduleStaffResult,
  ] = await Promise.all([
    supabase.from("scoring_categories").select("*").eq("rubric_id", rubric.id).eq("active", true).order("sort_order"),
    supabase.from("scoring_scale_levels").select("*").eq("rubric_id", rubric.id).order("score", { ascending: false }),
    profile.role === "adjudicator"
      ? supabase.from("adjudicator_assignments").select("*").eq("application_id", id).eq("adjudicator_user_id", profile.id)
      : supabase.from("adjudicator_assignments").select("*").eq("application_id", id).order("assigned_at"),
    profile.role === "adjudicator"
      ? supabase.from("adjudication_scorecards").select("*").eq("application_id", id).eq("adjudicator_user_id", profile.id)
      : supabase.from("adjudication_scorecards").select("*").eq("application_id", id).order("created_at"),
    profile.role === "adjudicator"
      ? Promise.resolve({ data: [], error: null })
      : supabase.from("adjudication_panel_feedback").select("*").eq("application_id", id),
    profile.role === "adjudicator"
      ? Promise.resolve({ data: null, error: null })
      : supabase.from("adjudication_releases").select("*").eq("application_id", id).maybeSingle(),
    supabase.rpc("get_schedule_bookings_for_staff"),
    supabase.rpc("get_schedule_staff_directory"),
  ]);

  const categories = (categoriesResult.data ?? []) as ScoringCategory[];
  const scale = (scaleResult.data ?? []) as ScoringScaleLevel[];
  const scoreOptions = quarterScoreOptions(
    Number(rubric.score_min),
    Number(rubric.score_max),
  );

  const scoreChoices = scoreOptions.map((score) => ({
    value: score,
    label:
      scale.find((level) => Number(level.score) === score)?.label ?? null,
  }));

  const assignments = (assignmentsResult.data ?? []) as AdjudicatorAssignment[];
  const scorecards = (scorecardsResult.data ?? []) as AdjudicationScorecard[];
  const feedback = (feedbackResult.data ?? []) as AdjudicationPanelFeedback[];
  const release = releaseResult.data as AdjudicationRelease | null;

  if (scheduleBookingsResult.error) {
    throw new Error(scheduleBookingsResult.error.message);
  }

  if (scheduleStaffResult.error) {
    throw new Error(scheduleStaffResult.error.message);
  }

  const scheduleBooking =
    ((scheduleBookingsResult.data ?? []) as ScheduleBookingReference[])
      .find((booking) => booking.application_id === id) ?? null;

  let scheduleSlot: ScheduleSlotReference | null = null;
  if (scheduleBooking) {
    const { data: scheduleSlotData, error: scheduleSlotError } =
      await supabase
        .from("schedule_slots")
        .select(
          "id,title,starts_at,ends_at,location,school_instructions,status",
        )
        .eq("id", scheduleBooking.slot_id)
        .maybeSingle();

    if (scheduleSlotError) throw new Error(scheduleSlotError.message);
    scheduleSlot = scheduleSlotData as ScheduleSlotReference | null;
  }

  const scheduledStaff =
    ((scheduleStaffResult.data ?? []) as ScheduleStaffReference[])
      .filter((staff) => staff.slot_id === scheduleBooking?.slot_id);

  const adjudicationReferencePanel: ApplicationReferencePanel = {
    key: "adjudication-calendar",
    title: "Adjudication Calendar",
    shortTitle: "Adjudication Details",
    description:
      "The school’s confirmed adjudication schedule and assigned panel.",
    groups: [
      {
        title: "School and production",
        items: [
          { label: "School", value: application.school_name },
          {
            label: "Production",
            value: application.production_title ?? "",
          },
          { label: "Application status", value: application.status },
        ],
      },
      {
        title: "Schedule",
        items: scheduleSlot
          ? [
              { label: "Schedule", value: scheduleSlot.title },
              {
                label: "Date",
                value: formatReferenceDate(scheduleSlot.starts_at),
              },
              {
                label: "Time",
                value: formatReferenceTime(
                  scheduleSlot.starts_at,
                  scheduleSlot.ends_at,
                ),
              },
              { label: "Location", value: scheduleSlot.location ?? "" },
              { label: "Status", value: scheduleSlot.status },
              {
                label: "School instructions",
                value: scheduleSlot.school_instructions ?? "",
              },
            ]
          : [
              {
                label: "Schedule",
                value: "No adjudication slot has been confirmed.",
              },
            ],
      },
      {
        title: "Assigned panel",
        items: scheduledStaff.length
          ? scheduledStaff.map((staff) => ({
              label:
                staff.role === "advisory_member"
                  ? "Advisory Committee"
                  : "Adjudicator",
              value: staff.full_name ?? staff.email ?? "Portal user",
            }))
          : [
              {
                label: "Panel",
                value: "No schedule panel members are currently listed.",
              },
            ],
      },
    ],
  };

  const referencePanels = [
    ...applicationReferencePanels,
    adjudicationReferencePanel,
  ];

  if (profile.role === "adjudicator" && assignments.length === 0) notFound();

  const categoryIds = categories.map((category) => category.id);
  const scorecardIds = scorecards.map((card) => card.id);
  const [criteriaResult, scoresResult, commentsResult] = await Promise.all([
    categoryIds.length
      ? supabase.from("scoring_criteria").select("*").in("category_id", categoryIds).eq("active", true).order("sort_order")
      : Promise.resolve({ data: [], error: null }),
    scorecardIds.length
      ? supabase.from("adjudication_scores").select("*").in("scorecard_id", scorecardIds)
      : Promise.resolve({ data: [], error: null }),
    scorecardIds.length
      ? supabase.from("adjudication_category_comments").select("*").in("scorecard_id", scorecardIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const criteria = (criteriaResult.data ?? []) as ScoringCriterion[];
  const scores = (scoresResult.data ?? []) as AdjudicationScore[];
  const comments = (commentsResult.data ?? []) as AdjudicationCategoryComment[];

  const sharedObservationResult =
    profile.role === "adjudicator"
      ? await supabase.rpc("get_shared_adjudication_observations", {
          p_application_id: id,
        })
      : { data: [], error: null };

  if (sharedObservationResult.error) {
    throw new Error(sharedObservationResult.error.message);
  }

  let adjudicatorProfiles: Profile[] = [];
  if (profile.role !== "adjudicator") {
    const profileIds = [...new Set(assignments.map((assignment) => assignment.adjudicator_user_id))];
    if (profileIds.length > 0) {
      const { data } = await supabase.from("profiles").select("id,email,full_name,role,active").in("id", profileIds);
      adjudicatorProfiles = (data ?? []) as Profile[];
    }
  }
  const ownScorecard = profile.role === "adjudicator" ? scorecards[0] ?? null : null;
  const readOnly = ownScorecard?.status === "submitted" || ownScorecard?.status === "locked";

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{cycle ? `${cycle.season_year} · ${cycle.name}` : "Adjudication"}</span>
          <h1>{application.school_name}</h1>
          <p>{application.production_title ?? "Untitled production"}</p>
        </div>
        <div className="heading-actions">
          {profile.role === "adjudicator" && <span className={`badge badge-scorecard-${ownScorecard?.status ?? "draft"}`}>{scorecardStatusLabel(ownScorecard?.status ?? "not started")}</span>}
          <Link className="button button-secondary" href="/portal/adjudication">Back to adjudication</Link>
        </div>
      </div>

      {query.saved && <div className="notice page-message">Your scorecard draft was saved.</div>}
      {query.submitted && <div className="notice page-message">Your scorecard was submitted and is now read-only.</div>}
      {query.generated && <div className="notice page-message">The AI narrative draft was generated. Review and edit it before approval.</div>}
      {query.released && <div className="notice page-message">The selected results were released to the school as a snapshot.</div>}
      {query.error === "required" && <div className="form-error page-message">Complete every required subject field, score, and criterion comment before submitting. Missing items: {query.missing ?? "one or more"}.</div>}

      <ApplicationReferenceBar panels={referencePanels} />

      <div className="adjudication-score-layout">
        <aside className="score-category-sidebar">
          <div className="score-category-sidebar-heading">
            <span className="eyebrow">Scorecard</span>
            <h2>Categories</h2>
            <p>Select a category to jump to that section.</p>
          </div>

          <nav
            className="score-category-tabs"
            aria-label="Scoring categories"
          >
            {categories.map((category, index) => (
              <a
                href={`#category-${category.id}`}
                key={category.id}
              >
                <span>{index + 1}</span>
                <strong>{category.title}</strong>
              </a>
            ))}
          </nav>
        </aside>

        <div className="adjudication-score-content">
      {profile.role === "adjudicator" ? (
        <form className="scorecard-form">
          <AdjudicatorAutosave
            applicationId={id}
            disabled={readOnly}
          />
          <section className="panel score-guide-panel">
            <div className="panel-header"><div><h2>Scoring guide</h2><p>Use the 1–10 scale in 0.25-point increments. Scores remain private to you, advisory members, and owners.</p></div></div>
            <div className="score-scale-grid">
              {scale.map((level) => <div key={level.id}><strong>{formatScore(level.score)}</strong><span>{level.label}</span><small>{level.description}</small></div>)}
            </div>
          </section>

          <CollaborativeAdjudicatorScorecard
            applicationId={id}
            categories={categories}
            categorySubjectDefaults={categorySubjectDefaults}
            criteria={criteria}
            currentUserId={profile.id}
            currentUserName={profile.full_name ?? profile.email ?? "Adjudicator"}
            initialPanelRows={(sharedObservationResult.data ?? []) as Array<{
              panel_order: number;
              adjudicator_user_id: string;
              adjudicator_name: string;
              criterion_id: string | null;
              observation: string | null;
              updated_at: string | null;
            }>}
            ownComments={comments.filter(
              (comment) => comment.scorecard_id === ownScorecard?.id,
            )}
            ownScores={scores.filter(
              (score) => score.scorecard_id === ownScorecard?.id,
            )}
            readOnly={readOnly}
            scoreOptions={scoreChoices}
          />

          <section className="panel"><div className="panel-body"><div className="field"><label htmlFor="scorecard_internal_notes">Overall private notes</label><textarea className="textarea" id="scorecard_internal_notes" name="scorecard_internal_notes" defaultValue={ownScorecard?.internal_notes ?? ""} disabled={readOnly} /></div></div></section>

          {!readOnly && (
            <div className="application-action-bar scorecard-action-bar">
              <button
                className="button button-secondary"
                formAction={saveAdjudicatorScorecard.bind(null, id, false)}
                type="submit"
              >
                Save draft
              </button>
              <ScorecardSubmitControls
                applicationId={id}
                categories={categories}
                criteria={criteria}
              />
            </div>
          )}
        </form>
      ) : (
        <>
          <OwnerLiveAdjudicationReview
            applicationId={id}
            isOwner={profile.role === "owner"}
            categories={categories}
            criteria={criteria}
            assignments={assignments}
            profiles={adjudicatorProfiles}
            initialScorecards={scorecards}
            initialScores={scores}
            initialComments={comments}
            initialFeedback={feedback}
            release={release}
          />

          {profile.role === "owner" && (
            <section className="panel release-panel">
              <div className="panel-header">
                <div>
                  <h2>Release results to the school</h2>
                  <p>
                    This creates a separate snapshot. Raw adjudicator scores,
                    identities, observations, and private notes are never exposed
                    to applicant accounts.
                  </p>
                </div>
              </div>
              <div className="panel-body">
                <form
                  action={releaseAdjudicationResults.bind(null, id)}
                  className="form-stack"
                >
                  <div className="release-choice-grid">
                    <label className="check-card">
                      <input name="release_scores" type="checkbox" />
                      <span>
                        <strong>Release category averages</strong>
                        <small>
                          Schools receive panel category averages only—not
                          individual adjudicator scores.
                        </small>
                      </span>
                    </label>
                    <label className="check-card">
                      <input name="release_feedback" type="checkbox" />
                      <span>
                        <strong>Release approved narratives</strong>
                        <small>Only approved final comments are included.</small>
                      </span>
                    </label>
                  </div>
                  <div className="field">
                    <label htmlFor="release_notes">Release note</label>
                    <textarea
                      className="textarea compact-textarea"
                      id="release_notes"
                      name="release_notes"
                      defaultValue={release?.release_notes ?? ""}
                    />
                  </div>
                  <button className="button button-dark" type="submit">
                    Release selected results
                  </button>
                </form>
              </div>
            </section>
          )}
        </>
      )}
        </div>
      </div>
    </>
  );
}
