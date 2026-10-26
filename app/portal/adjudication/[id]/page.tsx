import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatScore,
  quarterScoreOptions,
  resolveAdjudicationWorkspaceMode,
} from "@/lib/adjudication";
import { resolveScoringCategorySubjects } from "@/lib/application-scoring-subjects";
import { extractAcceptdPickSix } from "@/lib/acceptd/pick-six";
import {
  buildApplicationReferencePanels,
  type ApplicationEligibilityAppeal,
  type ApplicationReferencePanel,
} from "@/lib/application-reference-panels";
import {
  actingCandidateSubjectDefaults,
  actingCandidateReviewIsComplete,
  applyActingCandidatesToReferencePanels,
  createInitialActingCandidateReviewState,
  extractActingCandidates,
  extractDirectorName,
  parseActingCandidateReviewState,
} from "@/lib/acting-candidate-review";
import { AdjudicatorAutosave } from "@/components/adjudicator-autosave";
import { AdjudicationBrainDump } from "@/components/adjudication-brain-dump";
import {
  AdjudicationBigPictureComment,
  AdjudicationOverallProduction,
} from "@/components/adjudication-overall-production";
import { ApplicationReferenceBar } from "@/components/application-reference-bar";
import { CollaborativeAdjudicatorScorecard } from "@/components/collaborative-adjudicator-scorecard";
import { AdjudicationConsensusBar } from "@/components/adjudication-consensus-bar";
import { AdjudicationScoringGuideHeading } from "@/components/adjudication-scoring-guide-heading";
import { CompleteAdjudicationControl } from "@/components/complete-adjudication-control";
import {
  OwnerLiveAdjudicationReview,
  type PanelNarrativeReviewer,
} from "@/components/owner-live-adjudication-review";
import { ScorecardSubmitControls } from "@/components/scorecard-submit-controls";
import { SpecialtyAwardModal } from "@/components/specialty-award-modal";
import { SpecialtyAwardWorkspace } from "@/components/specialty-award-workspace";
import { requireProfile } from "@/lib/auth";
import { isAdjudicationCategoryComplete } from "@/lib/adjudication-category-completion";
import { categoryDecisionApprovedForUser } from "@/lib/adjudication-category-decisions";
import { outstandingAssignedFinalComments } from "@/lib/adjudication-completion";
import {
  loadAdjudicationObserverSnapshot,
  resolveAdjudicationObserverAccess,
} from "@/lib/adjudication-observer";
import { OVERALL_PRODUCTION_CATEGORY_KEY } from "@/lib/adjudication-overall-score";
import { isValidTwoPointRange } from "@/lib/adjudication-ranges";
import { loadAdjudicationReferenceLinks } from "@/lib/adjudication-reference-documents";
import { createAdminClient } from "@/lib/supabase/admin";
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
  ApplicationFormVersion,
  ApplicationQuestion,
  AwardCycle,
  Profile,
  ScoringCategory,
  ScoringCriterion,
  ScoringRubric,
  ScoringScaleLevel,
} from "@/lib/types";

import { releaseAdjudicationResults } from "./actions";

export const maxDuration = 800;

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
  participation_mode: "panel" | "understudy" | "shadow";
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

type ScheduleSchoolDetailReference = {
  venue_name: string | null;
  venue_address: string | null;
  arrival_entrance: string | null;
  parking_instructions: string | null;
  accessibility_notes: string | null;
  wifi_network: string | null;
  wifi_password: string | null;
  day_of_contact_name: string | null;
  day_of_contact_phone: string | null;
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
    released?: string;
    channel_notice?: string;
    assigned?: string;
    error?: string;
    missing?: string;
  }>;
}) {
  const profile = await requireProfile(["adjudicator", "advisory_member", "owner"]);
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const admin = createAdminClient();
  const referenceLinksPromise = loadAdjudicationReferenceLinks(supabase);
  const scheduleContextPromise = Promise.all([
    supabase.rpc("get_schedule_bookings_for_staff"),
    supabase.rpc("get_schedule_staff_directory"),
  ]);
  const observerAccessPromise =
    profile.role === "owner"
      ? Promise.resolve({
          allowed: false,
          scheduledShadow: false,
          readOnlyAssignment: false,
        })
      : resolveAdjudicationObserverAccess({
          admin,
          applicationId: id,
          userId: profile.id,
        });

  const [
    [scheduleBookingsResult, scheduleStaffResult],
    observerAccess,
  ] = await Promise.all([scheduleContextPromise, observerAccessPromise]);
  if (scheduleBookingsResult.error) {
    throw new Error(scheduleBookingsResult.error.message);
  }
  if (scheduleStaffResult.error) {
    throw new Error(scheduleStaffResult.error.message);
  }

  const scheduleBooking =
    ((scheduleBookingsResult.data ?? []) as ScheduleBookingReference[])
      .find((booking) => booking.application_id === id) ?? null;
  const scheduledStaff =
    ((scheduleStaffResult.data ?? []) as ScheduleStaffReference[])
      .filter((staff) => staff.slot_id === scheduleBooking?.slot_id);
  const isScheduledShadow = observerAccess.scheduledShadow;
  const applicationReadClient = observerAccess.allowed ? admin : supabase;

  const { data: applicationData, error: applicationError } = await applicationReadClient
    .from("applications")
    .select("*")
    .eq("id", id)
    .single();
  if (applicationError || !applicationData) notFound();
  const application = applicationData as Application;

  const [applicationQuestionsResult, applicationAnswersResult] =
    application.form_version_id
      ? await Promise.all([
          applicationReadClient
            .from("application_questions")
            .select(
              "id,form_version_id,section_id,question_key,label,description,question_type,required,options,settings,visibility_rule,sort_order,active,source_column_index,source_label,imported,created_at,updated_at",
            )
            .eq("form_version_id", application.form_version_id),
          applicationReadClient
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

  const submittedCategorySubjectDefaults = resolveScoringCategorySubjects({
    application,
    questions: applicationQuestions,
    answers: applicationAnswers,
  });

  const { data: cycleData } = await applicationReadClient.from("award_cycles").select("*").eq("id", application.cycle_id).single();
  const cycle = cycleData as AwardCycle | null;

  const { data: formVersionData, error: formVersionError } =
    application.form_version_id
      ? await applicationReadClient
          .from("application_form_versions")
          .select("id,cycle_id,scoring_rubric_id,version_number,name,status,published_at,created_at,updated_at")
          .eq("id", application.form_version_id)
          .maybeSingle()
      : { data: null, error: null };
  if (formVersionError) throw new Error(formVersionError.message);
  const applicationForm = formVersionData as ApplicationFormVersion | null;

  const { data: rubricData, error: rubricError } = applicationForm?.scoring_rubric_id
    ? await applicationReadClient
        .from("scoring_rubrics")
        .select("*")
        .eq("id", applicationForm.scoring_rubric_id)
        .maybeSingle()
    : { data: null, error: null };
  if (rubricError) throw new Error(rubricError.message);
  const rubric = rubricData as ScoringRubric | null;

  const ownParticipantResult =
    profile.role === "owner"
      ? { data: null, error: null }
      : await supabase
          .from("adjudicator_assignments")
          .select("id,can_score,can_comment,removed_at")
          .eq("application_id", id)
          .eq("adjudicator_user_id", profile.id)
          .is("removed_at", null)
          .maybeSingle();

  if (ownParticipantResult.error) {
    throw new Error(ownParticipantResult.error.message);
  }

  const hasReadOnlyAssignment = observerAccess.readOnlyAssignment;
  const isReadOnlyObserver =
    profile.role !== "owner" &&
    (isScheduledShadow || hasReadOnlyAssignment);
  const workspaceReadClient = isReadOnlyObserver ? admin : supabase;

  const isScoringParticipant =
    !isReadOnlyObserver &&
    Boolean(
      ownParticipantResult.data?.can_score ||
        ownParticipantResult.data?.can_comment,
    );

  const advisoryReviewAccessResult =
    profile.role === "advisory_member"
      ? await supabase.rpc("can_advisory_review_application", {
          p_application_id: id,
          p_user_id: profile.id,
        })
      : { data: profile.role === "owner", error: null };

  if (advisoryReviewAccessResult.error) {
    throw new Error(advisoryReviewAccessResult.error.message);
  }

  const canPanelReview =
    profile.role === "owner" ||
    (profile.role === "advisory_member" &&
      Boolean(advisoryReviewAccessResult.data) &&
      !isReadOnlyObserver);
  const workspaceMode = resolveAdjudicationWorkspaceMode({
    role: profile.role,
    isScoringParticipant,
    canPanelReview,
    isReadOnlyObserver,
  });
  const showPersonalScorecard = workspaceMode === "personal_scorecard";
  const canEditAdvisoryScorecard =
    profile.role === "advisory_member" &&
    canPanelReview &&
    Boolean(
      ownParticipantResult.data?.can_score ||
        ownParticipantResult.data?.can_comment,
    );
  const showEditableScorecard =
    showPersonalScorecard || canEditAdvisoryScorecard;

  if (!rubric) {
    return (
      <>
        <div className="page-heading"><div><h1>{application.school_name}</h1><p>{application.production_title ?? "Untitled production"}</p></div></div>
        <section className="panel"><div className="empty-state"><h3>No scoring rubric assigned</h3><p>An owner must assign the active rubric to this application&apos;s published form before adjudication can begin.</p>{profile.role === "owner" && application.form_version_id && <Link className="button button-dark" href={`/portal/admin/forms/${application.form_version_id}`}>Open application form</Link>}</div></section>
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
    panelAssignmentsResult,
    appealsResult,
    candidateReviewResult,
    acceptdSnapshotResult,
  ] = await Promise.all([
    supabase.from("scoring_categories").select("*").eq("rubric_id", rubric.id).eq("active", true).order("sort_order"),
    supabase.from("scoring_scale_levels").select("*").eq("rubric_id", rubric.id).order("score", { ascending: false }),
    profile.role === "adjudicator"
      ? supabase
          .from("adjudicator_assignments")
          .select("*")
          .eq("application_id", id)
          .eq("adjudicator_user_id", profile.id)
          .is("removed_at", null)
      : supabase
          .from("adjudicator_assignments")
          .select("*")
          .eq("application_id", id)
          .or("removed_at.is.null,status.eq.complete")
          .order("assigned_at"),
    profile.role === "adjudicator"
      ? supabase.from("adjudication_scorecards").select("*").eq("application_id", id).eq("adjudicator_user_id", profile.id)
      : supabase.from("adjudication_scorecards").select("*").eq("application_id", id).order("created_at"),
    admin.from("adjudication_panel_feedback").select("*").eq("application_id", id),
    profile.role === "adjudicator"
      ? Promise.resolve({ data: null, error: null })
      : supabase.from("adjudication_releases").select("*").eq("application_id", id).maybeSingle(),
    isScoringParticipant || canPanelReview || isReadOnlyObserver
      ? admin
          .from("adjudicator_assignments")
          .select("adjudicator_user_id,can_comment,can_score")
          .eq("application_id", id)
          .is("removed_at", null)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from("appeals")
      .select(
        "category_id,current_eligibility,requested_eligibility,status,submitted_at",
      )
      .eq("application_id", id)
      .eq("appeal_type", "eligibility")
      .order("submitted_at", { ascending: false }),
    admin
      .from("acting_candidate_reviews")
      .select("state,updated_at")
      .eq("application_id", id)
      .maybeSingle(),
    profile.role === "owner" && application.source_system === "acceptd-api-v2"
      ? admin
          .from("acceptd_application_snapshots")
          .select("payload")
          .eq("portal_application_id", id)
          .order("last_synced_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const categories = (categoriesResult.data ?? []) as ScoringCategory[];
  const applicationReferencePanels = buildApplicationReferencePanels({
    application,
    questions: applicationQuestions,
    answers: applicationAnswers,
    eligibilityCategories: categories,
    eligibilityAppeals: (appealsResult.data ?? []) as ApplicationEligibilityAppeal[],
  });
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
  const acceptdPickSix = extractAcceptdPickSix(
    acceptdSnapshotResult.data?.payload,
  );

  if (feedbackResult.error) throw new Error(feedbackResult.error.message);
  if (appealsResult.error) throw new Error(appealsResult.error.message);
  if (panelAssignmentsResult.error) {
    throw new Error(panelAssignmentsResult.error.message);
  }
  if (acceptdSnapshotResult.error) {
    console.error("Acceptd Pick 6 selections could not be loaded", {
      applicationId: id,
      code: acceptdSnapshotResult.error.code,
      message: acceptdSnapshotResult.error.message,
    });
  }
  // Candidate confirmation is an add-on to the adjudication workspace. If its
  // audit lookup is unavailable, keep the scorecard usable and start from the
  // application roster instead of sending the entire route to the error page.
  if (candidateReviewResult.error) {
    console.error("Acting candidate review history could not be loaded", {
      applicationId: id,
      code: candidateReviewResult.error.code,
      message: candidateReviewResult.error.message,
    });
  }

  const panelReviewerIds = [
    ...new Set(
      (panelAssignmentsResult.data ?? []).map(
        (assignment) => assignment.adjudicator_user_id,
      ),
    ),
  ];
  const panelReviewerProfilesPromise = panelReviewerIds.length
    ? Promise.resolve(
        admin
          .from("profiles")
          .select("id,full_name,email,role,active")
          .in("id", panelReviewerIds)
          .in("role", ["adjudicator", "advisory_member"]),
      )
    : Promise.resolve({ data: [], error: null });
  const commentingPanelMemberIds = new Set(
    (panelAssignmentsResult.data ?? [])
      .filter((assignment) => assignment.can_comment)
      .map((assignment) => assignment.adjudicator_user_id),
  );

  const feedbackApproverIds = [
    ...new Set(
      feedback
        .map((item) => item.approved_by)
        .filter((userId): userId is string => Boolean(userId)),
    ),
  ];
  const feedbackApproverResult = feedbackApproverIds.length
    ? await admin
        .from("profiles")
        .select("id,role")
        .in("id", feedbackApproverIds)
    : { data: [], error: null };
  if (feedbackApproverResult.error) {
    throw new Error(feedbackApproverResult.error.message);
  }
  const panelApproverIds = new Set(
    (feedbackApproverResult.data ?? [])
      .filter((approver) =>
        ["adjudicator", "advisory_member"].includes(approver.role),
      )
      .map((approver) => approver.id),
  );
  const panelApprovedCategoryIds = feedback
    .filter(
      (item) =>
        item.status === "approved" &&
        item.approved_by &&
        panelApproverIds.has(item.approved_by),
    )
    .map((item) => item.category_id);
  const panelVisibleFeedback = feedback.filter(
    (item) =>
      item.status === "approved" &&
      (profile.role !== "adjudicator" || item.assigned_to === profile.id),
  );

  let scheduleSlot: ScheduleSlotReference | null = null;
  let scheduleSchoolDetails: ScheduleSchoolDetailReference | null = null;
  if (scheduleBooking) {
    const { data: scheduleSlotData, error: scheduleSlotError } =
      await workspaceReadClient
        .from("schedule_slots")
        .select(
          "id,title,starts_at,ends_at,location,school_instructions,status",
        )
        .eq("id", scheduleBooking.slot_id)
        .maybeSingle();

    if (scheduleSlotError) throw new Error(scheduleSlotError.message);
    scheduleSlot = scheduleSlotData as ScheduleSlotReference | null;

    const { data: detailData, error: detailError } = await workspaceReadClient
      .from("schedule_slot_school_details")
      .select("venue_name,venue_address,arrival_entrance,parking_instructions,accessibility_notes,wifi_network,wifi_password,day_of_contact_name,day_of_contact_phone")
      .eq("slot_id", scheduleBooking.slot_id)
      .maybeSingle();
    if (detailError) throw new Error(detailError.message);
    scheduleSchoolDetails = detailData as ScheduleSchoolDetailReference | null;
  }

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
              { label: "Location", value: scheduleSchoolDetails?.venue_name ?? scheduleSlot.location ?? "" },
              { label: "Address", value: scheduleSchoolDetails?.venue_address ?? "" },
              { label: "Arrival entrance", value: scheduleSchoolDetails?.arrival_entrance ?? "" },
              { label: "Parking", value: scheduleSchoolDetails?.parking_instructions ?? "" },
              { label: "Accessibility", value: scheduleSchoolDetails?.accessibility_notes ?? "" },
              { label: "Wi-Fi network", value: scheduleSchoolDetails?.wifi_network ?? "" },
              { label: "Wi-Fi password", value: scheduleSchoolDetails?.wifi_password ?? "" },
              { label: "Day-of contact", value: scheduleSchoolDetails?.day_of_contact_name ?? "" },
              { label: "Day-of phone", value: scheduleSchoolDetails?.day_of_contact_phone ?? "" },
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

  if (
    profile.role === "adjudicator" &&
    !ownParticipantResult.data &&
    !isScheduledShadow
  ) {
    notFound();
  }

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
  const observerSnapshot = isReadOnlyObserver
    ? await loadAdjudicationObserverSnapshot({ admin, applicationId: id })
    : null;

  let proposalQuery = workspaceReadClient
    .from("adjudication_category_proposals")
    .select("*")
    .eq("application_id", id);
  if (profile.role === "adjudicator") {
    proposalQuery = proposalQuery.neq("status", "draft");
  }

  const [proposalResult, scoreabilityResult, reviewResult] = await Promise.all([
    observerSnapshot
      ? Promise.resolve({ data: observerSnapshot.proposals, error: null })
      : proposalQuery,
    workspaceReadClient
      .from("adjudication_category_scoreability")
      .select("category_id,is_scoreable,reason")
      .eq("application_id", id),
    workspaceReadClient
      .from("adjudication_reviews")
      .select("status,owner_note")
      .eq("application_id", id)
      .maybeSingle(),
  ]);

  if (proposalResult.error) throw new Error(proposalResult.error.message);
  if (scoreabilityResult.error) throw new Error(scoreabilityResult.error.message);
  if (reviewResult.error) throw new Error(reviewResult.error.message);

  const proposalIds = (proposalResult.data ?? []).map(
    (proposal) => proposal.id,
  );

  const approvalResult = proposalIds.length
    ? observerSnapshot
      ? { data: observerSnapshot.approvals, error: null }
      : await workspaceReadClient
        .from("adjudication_category_approvals")
        .select("*")
        .in("proposal_id", proposalIds)
    : { data: [], error: null };

  if (approvalResult.error) throw new Error(approvalResult.error.message);

  const specialtyResult =
    canPanelReview &&
    (profile.role === "advisory_member" || profile.role === "owner")
      ? await supabase
          .from("advisory_specialty_award_recommendations")
          .select(
            "id,application_id,advisory_user_id,award_type,recommendation_status,song_title,explanation,status,submitted_at,updated_at",
          )
          .eq("application_id", id)
          .order("updated_at", { ascending: false })
      : { data: [], error: null };

  if (specialtyResult.error) {
    throw new Error(specialtyResult.error.message);
  }

  let specialtyRows = specialtyResult.data ?? [];
  if (profile.role === "owner" && specialtyRows.length > 0) {
    const specialtyUserIds = [
      ...new Set(specialtyRows.map((row) => row.advisory_user_id)),
    ];
    const { data: specialtyProfiles } = await supabase
      .from("profiles")
      .select("id,full_name,email")
      .in("id", specialtyUserIds);
    const specialtyProfileMap = new Map(
      (specialtyProfiles ?? []).map((row) => [row.id, row]),
    );
    specialtyRows = specialtyRows.map((row) => ({
      ...row,
      advisory_member_name:
        specialtyProfileMap.get(row.advisory_user_id)?.full_name ?? null,
      advisory_member_email:
        specialtyProfileMap.get(row.advisory_user_id)?.email ?? null,
    }));
  }

  const sharedObservationResult =
    isReadOnlyObserver && observerSnapshot
      ? { data: observerSnapshot.panelRows, error: null }
      : showPersonalScorecard
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
  const { data: panelReviewerProfiles, error: panelReviewerProfilesError } =
    await panelReviewerProfilesPromise;
  if (panelReviewerProfilesError) {
    throw new Error(panelReviewerProfilesError.message);
  }
  const candidatePanelReviewers = (panelReviewerProfiles ?? [])
    .filter((reviewer) => reviewer.active)
    .map((reviewer) => ({
      id: reviewer.id,
      name: reviewer.full_name ?? reviewer.email ?? "Panel member",
      role: reviewer.role as PanelNarrativeReviewer["role"],
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const panelNarrativeReviewers = candidatePanelReviewers.filter((reviewer) =>
    commentingPanelMemberIds.has(reviewer.id),
  );
  const scoringPanelMemberIds = new Set(
    (panelAssignmentsResult.data ?? [])
      .filter((assignment) => assignment.can_score)
      .map((assignment) => assignment.adjudicator_user_id),
  );
  const rangeApprovalReviewers = (panelReviewerProfiles ?? [])
    .filter((reviewer) => scoringPanelMemberIds.has(reviewer.id))
    .map((reviewer) => ({
      id: reviewer.id,
      name: reviewer.full_name ?? reviewer.email ?? "Panel member",
      role: reviewer.role as "adjudicator" | "advisory_member",
      active: reviewer.active,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const originalActingCandidates = extractActingCandidates(
    applicationReferencePanels,
  );
  const applicationDirectorName = extractDirectorName(
    applicationReferencePanels,
  );
  const actingCandidateReview =
    parseActingCandidateReviewState(candidateReviewResult.data?.state) ??
    createInitialActingCandidateReviewState({
      applicationId: id,
      candidates: originalActingCandidates,
      requiredApproverIds: candidatePanelReviewers.map(
        (reviewer) => reviewer.id,
      ),
      directorName: applicationDirectorName,
    });
  const categorySubjectDefaults: Record<string, string> = {
    ...submittedCategorySubjectDefaults,
    ...actingCandidateSubjectDefaults(actingCandidateReview.candidates),
  };
  const referencePanels = [
    ...applyActingCandidatesToReferencePanels(
      applicationReferencePanels,
      actingCandidateReview.candidates,
    ),
    adjudicationReferencePanel,
  ];
  const ownScorecard = showEditableScorecard
    ? scorecards.find((scorecard) => scorecard.adjudicator_user_id === profile.id) ?? null
    : null;
  const readOnly = ownScorecard?.status === "submitted" || ownScorecard?.status === "locked";
  const outstandingAssignedCommentCount =
    profile.role === "adjudicator"
      ? outstandingAssignedFinalComments(feedback, profile.id).length
      : 0;
  const canComment = Boolean(ownParticipantResult.data?.can_comment);
  const ownScores = scores.filter(
    (score) => score.scorecard_id === ownScorecard?.id,
  );
  const ownScoreByCriterion = new Map(
    ownScores.map((score) => [score.criterion_id, score]),
  );
  const categoryScoreability = (scoreabilityResult.data ?? []) as Array<{
    category_id: string;
    is_scoreable: boolean;
    reason: string | null;
  }>;
  const unscoreableCategoryIds = new Set(
    categoryScoreability
      .filter((decision) => !decision.is_scoreable)
      .map((decision) => decision.category_id),
  );
  const scoreableCategories = categories.filter(
    (category) => !unscoreableCategoryIds.has(category.id),
  );
  const scoreableCategoryIds = new Set(
    scoreableCategories.map((category) => category.id),
  );
  const scoreableCriteria = criteria.filter((criterion) =>
    scoreableCategoryIds.has(criterion.category_id),
  );
  const overallProductionCategory = scoreableCategories.find(
    (category) =>
      category.category_key === OVERALL_PRODUCTION_CATEGORY_KEY,
  );
  const decisionCategories = categories.filter(
    (category) =>
      category.category_key !== OVERALL_PRODUCTION_CATEGORY_KEY,
  );
  const visibleDecisionCategories =
    profile.role === "adjudicator"
      ? decisionCategories.filter(
          (category) => !unscoreableCategoryIds.has(category.id),
        )
      : decisionCategories;
  const narrativeCategories = scoreableCategories.filter(
    (category) =>
      category.category_key !== OVERALL_PRODUCTION_CATEGORY_KEY,
  );
  const initiallyCompletedCategoryIds =
    showEditableScorecard
      ? narrativeCategories
          .filter((category) => {
            const categoryCriteria = criteria.filter(
              (criterion) => criterion.category_id === category.id,
            );

            return isAdjudicationCategoryComplete({
              comments: categoryCriteria.map(
                (criterion) =>
                  ownScoreByCriterion.get(criterion.id)?.observation,
              ),
              requireComments: canComment,
              scores: categoryCriteria.map(
                (criterion) => ownScoreByCriterion.get(criterion.id)?.score,
              ),
            });
          })
          .map((category) => category.id)
      : [];
  const referenceLinks = await referenceLinksPromise;
  const showConsensusControls = showEditableScorecard || canPanelReview;
  const compactConsensusControls =
    showConsensusControls &&
    (profile.role === "adjudicator" || profile.role === "advisory_member");
  const scorecardFormId = `adjudication-scorecard-${id}`;
  const proposalByCategoryId = new Map(
    (proposalResult.data ?? []).map((proposal) => [
      proposal.category_id,
      proposal,
    ]),
  );
  const ownApprovalByProposalId = new Map(
    (approvalResult.data ?? [])
      .filter(
        (approval) => approval.adjudicator_user_id === profile.id,
      )
      .map((approval) => [approval.proposal_id, approval]),
  );
  const categoryDecisionsComplete =
    visibleDecisionCategories.length > 0 &&
    visibleDecisionCategories.every((category) => {
      const proposal = proposalByCategoryId.get(category.id);
      if (
        !proposal ||
        !isValidTwoPointRange(proposal.range_min, proposal.range_max)
      ) {
        return false;
      }

      return categoryDecisionApprovedForUser({
        proposalStatus: proposal.status,
        ownResponse: ownApprovalByProposalId.get(proposal.id)?.response,
      });
    });
  const candidateReviewComplete =
    profile.role === "adjudicator"
      ? actingCandidateReviewIsComplete(actingCandidateReview, profile.id)
      : actingCandidateReview.status === "approved";
  const categoryReviewComplete =
    categoryDecisionsComplete && candidateReviewComplete;
  const panelReviewWorkspace = (
    <OwnerLiveAdjudicationReview
      applicationId={id}
      acceptdPickSix={acceptdPickSix}
      isOwner={profile.role === "owner"}
      advisoryNarrativeReview={
        profile.role === "advisory_member"
          ? {
              canComment,
              currentUserId: profile.id,
              panelReviewers: panelNarrativeReviewers,
              panelApprovedCategoryIds,
              reviewStatus: reviewResult.data?.status ?? "draft",
            }
          : undefined
      }
      advisoryScoreEntry={
        canEditAdvisoryScorecard
          ? {
              canComment,
              canScore: Boolean(ownParticipantResult.data?.can_score),
              currentUserId: profile.id,
              readOnly,
              scoreOptions: scoreChoices,
            }
          : undefined
      }
      categories={scoreableCategories}
      categoryProposals={(proposalResult.data ?? []) as Array<{
        category_id: string;
        is_eligible: boolean;
        range_min: number | null;
        range_max: number | null;
        status: string;
        advisory_note: string | null;
        owner_override_note: string | null;
      }>}
      categorySubjectDefaults={categorySubjectDefaults}
      criteria={scoreableCriteria}
      assignments={assignments}
      profiles={adjudicatorProfiles}
      initialScorecards={scorecards}
      initialScores={scores}
      initialComments={comments}
      initialFeedback={
        profile.role === "owner" ? feedback : panelVisibleFeedback
      }
      productionTitle={application.production_title ?? "Untitled production"}
      release={release}
    />
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{cycle ? `${cycle.season_year} · ${cycle.name}` : "Adjudication"}</span>
          <h1>{application.school_name}</h1>
          <p>{application.production_title ?? "Untitled production"}</p>
        </div>
        <div className="heading-actions">
          {showEditableScorecard && <span className={`badge badge-scorecard-${ownScorecard?.status ?? "draft"}`}>{scorecardStatusLabel(ownScorecard?.status ?? "not started")}</span>}
          {isReadOnlyObserver ? (
            <span className="badge badge-draft">Shadow · read only</span>
          ) : null}
          <Link className="button button-secondary" href="/portal/adjudication">Back to adjudication</Link>
        </div>
      </div>

      {query.saved && <div className="notice page-message">Your scorecard draft was saved.</div>}
      {query.submitted && <div className="notice page-message">Your scorecard was submitted. Scores and brain-dump tools are now locked while you finish any assigned final comments.</div>}
      {query.released && <div className="notice page-message">The selected results were released to the school as a snapshot.</div>}
      {query.released && query.channel_notice === "sent" && <div className="notice page-message">A release notice was posted in the school channel.</div>}
      {query.released && query.channel_notice === "failed" && <div className="form-error page-message">The results were released, but the school-channel notice could not be posted. You can safely try the release again or notify the school manually.</div>}
      {query.assigned && <div className="notice page-message">The final comment assignment was saved.</div>}
      {query.error === "required" && <div className="form-error page-message">Complete every required subject field and score{canComment ? ", including criterion comments," : ""} before submitting. Missing items: {query.missing ?? "one or more"}.</div>}
      {query.error === "assignment" && <div className="form-error page-message">The final comment assignment could not be saved. Refresh the page and try again.</div>}

      {showEditableScorecard && !canComment && (
        <div className="comment-permission-banner" role="status">
          <span aria-hidden="true">◇</span>
          <div>
            <strong>Commenting is off for this assignment</strong>
            <p>You can enter scores, but observation and private-note fields are read-only.</p>
          </div>
        </div>
      )}

      <ApplicationReferenceBar
        categoryWorkflowControl={
          profile.role === "advisory_member" && canPanelReview ? (
            <SpecialtyAwardModal
              applicationId={id}
              currentUserId={profile.id}
              recommendations={specialtyRows}
            />
          ) : undefined
        }
        categoryNavigation={{
          categories: narrativeCategories,
          initialCompletedCategoryIds: initiallyCompletedCategoryIds,
          showCompletion: showEditableScorecard,
        }}
        links={referenceLinks}
        panelCommentControls={
          profile.role === "adjudicator" && showEditableScorecard
            ? {
                currentUserId: profile.id,
                peerCount: panelReviewerIds.filter(
                  (reviewerId) => reviewerId !== profile.id,
                ).length,
              }
            : undefined
        }
        panels={referencePanels}
        showFullScoreView={
          canPanelReview &&
          (profile.role === "owner" || profile.role === "advisory_member")
        }
        reviewActions={compactConsensusControls
          ? {
              categoryReviewStatus: categoryReviewComplete
                ? "complete"
                : "needs-action",
              showCategoryReview: true,
              showPanelReview:
                profile.role === "advisory_member" && canPanelReview,
            }
          : undefined}
        scorecardSubmitControl={
          showEditableScorecard && !readOnly ? (
            <ScorecardSubmitControls
              applicationId={id}
              categories={scoreableCategories}
              compact
              criteria={scoreableCriteria}
              formId={scorecardFormId}
              requireComments={canComment}
            />
          ) : profile.role === "adjudicator" && readOnly ? (
            <CompleteAdjudicationControl
              applicationId={id}
              outstandingCommentCount={outstandingAssignedCommentCount}
            />
          ) : undefined
        }
      />

      {showConsensusControls && (
      <AdjudicationConsensusBar
        actingCandidateReview={actingCandidateReview}
        actingCandidateReviewers={candidatePanelReviewers}
        adjudicatorCategoryScores={
          profile.role === "adjudicator"
            ? visibleDecisionCategories.map((category) => ({
                category_id: category.id,
                criteria: criteria
                  .filter(
                    (criterion) => criterion.category_id === category.id,
                  )
                  .map((criterion) => ({
                    criterion_id: criterion.id,
                    score:
                      ownScoreByCriterion.get(criterion.id)?.score ?? null,
                  })),
              }))
            : undefined
        }
        applicationId={id}
        approvals={(approvalResult.data ?? []) as Array<{
          id: string;
          proposal_id: string;
          adjudicator_user_id: string;
          response: string;
          comment: string | null;
        }>}
        categories={visibleDecisionCategories}
        currentUserId={profile.id}
        narrativeAssignments={feedback.map((item) => ({
          category_id: item.category_id,
          assigned_to: item.assigned_to,
        }))}
        narrativesReady={
          narrativeCategories.length > 0 &&
          narrativeCategories.every((category) =>
            panelApprovedCategoryIds.includes(category.id),
          )
        }
        proposals={(proposalResult.data ?? []) as Array<{
          id: string;
          application_id: string;
          category_id: string;
          proposed_by: string;
          is_eligible: boolean;
          range_min: number | null;
          range_max: number | null;
          status: string;
          advisory_note: string | null;
          owner_override_note: string | null;
        }>}
        scoreability={categoryScoreability}
        review={reviewResult.data as { status: string; owner_note: string | null } | null}
        panelReviewers={panelNarrativeReviewers}
        rangeReviewers={rangeApprovalReviewers}
        role={profile.role}
        compact={compactConsensusControls}
      />
      )}

      <div className="adjudication-score-layout adjudication-score-layout-single">
        <div className="adjudication-score-content">
      {workspaceMode === "personal_scorecard" ? (
        <>
        <form className="scorecard-form" id={scorecardFormId}>
          <AdjudicatorAutosave
            applicationId={id}
            disabled={readOnly}
          />
          <AdjudicationBrainDump
            applicationId={id}
            canComment={canComment}
            defaultValue={ownScorecard?.internal_notes}
            fieldName="scorecard_internal_notes"
            readOnly={readOnly}
            scorecardId={ownScorecard?.id}
            title="INITIAL BRAIN DUMP (INTERMISSION)"
          />
          <AdjudicationBrainDump
            applicationId={id}
            canComment={canComment}
            defaultValue={ownScorecard?.post_show_notes}
            fieldName="scorecard_post_show_notes"
            readOnly={readOnly}
            scorecardId={ownScorecard?.id}
            title="INITIAL BRAIN DUMP (POST SHOW)"
          />
          <section className="panel score-guide-panel">
            <div className="panel-header">
              <AdjudicationScoringGuideHeading
                initialCategoryTitle={narrativeCategories[0]?.title ?? ""}
              />
            </div>
            <div className="score-scale-grid">
              {scale.map((level) => <div key={level.id}><strong>{formatScore(level.score)}</strong><span>{level.label}</span><small>{level.description}</small></div>)}
            </div>
          </section>

          <CollaborativeAdjudicatorScorecard
            activePanelUserIds={panelReviewerIds}
            afterCategory={
              <>
                <AdjudicationBigPictureComment
                  canComment={canComment}
                  categories={scoreableCategories}
                  criteria={scoreableCriteria}
                  ownScores={ownScores}
                  privateNotes={comments.find(
                    (comment) =>
                      comment.scorecard_id === ownScorecard?.id &&
                      comment.category_id === overallProductionCategory?.id,
                  )?.private_notes}
                  readOnly={readOnly}
                />
                <AdjudicationOverallProduction
                  categories={scoreableCategories}
                  criteria={scoreableCriteria}
                  ownScores={ownScores}
                />
              </>
            }
            applicationId={id}
            categories={narrativeCategories}
            categorySubjectDefaults={categorySubjectDefaults}
            criteria={scoreableCriteria}
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
            categoryProposals={(proposalResult.data ?? []) as Array<{
              id: string;
              category_id: string;
              is_eligible: boolean;
              range_min: number | null;
              range_max: number | null;
              status: string;
              advisory_note: string | null;
            }>}
            categoryApprovals={(approvalResult.data ?? []) as Array<{
              proposal_id: string;
              adjudicator_user_id: string;
              response: string;
              comment: string | null;
            }>}
            panelFeedback={panelVisibleFeedback}
            panelReviewers={panelNarrativeReviewers}
            panelApprovedCategoryIds={panelApprovedCategoryIds}
            reviewStatus={reviewResult.data?.status ?? "draft"}
            ownScores={ownScores}
            canComment={canComment}
            readOnly={readOnly}
            scoreOptions={scoreChoices}
            productionTitle={
              application.production_title ?? "Untitled production"
            }
          />

        </form>
        </>
      ) : workspaceMode === "read_only_observer" ? (
        <>
          <section className="panel shadow-adjudication-notice" role="status">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Shadow view</span>
                <h2>Adjudication is available in read-only mode</h2>
                <p>
                  You can follow the categories and the assigned panel&apos;s live
                  observations. Shadows do not receive score, comment,
                  brain-dump, approval, or submission fields.
                </p>
              </div>
            </div>
          </section>

          <section className="panel score-guide-panel">
            <div className="panel-header">
              <AdjudicationScoringGuideHeading
                initialCategoryTitle={narrativeCategories[0]?.title ?? ""}
              />
            </div>
            <div className="score-scale-grid">
              {scale.map((level) => (
                <div key={level.id}>
                  <strong>{formatScore(level.score)}</strong>
                  <span>{level.label}</span>
                  <small>{level.description}</small>
                </div>
              ))}
            </div>
          </section>

          <CollaborativeAdjudicatorScorecard
            activePanelUserIds={panelReviewerIds}
            applicationId={id}
            categories={narrativeCategories}
            categoryApprovals={(approvalResult.data ?? []) as Array<{
              proposal_id: string;
              adjudicator_user_id: string;
              response: string;
              comment: string | null;
            }>}
            categoryProposals={(proposalResult.data ?? []) as Array<{
              id: string;
              category_id: string;
              is_eligible: boolean;
              range_min: number | null;
              range_max: number | null;
              status: string;
              advisory_note: string | null;
            }>}
            categorySubjectDefaults={categorySubjectDefaults}
            criteria={scoreableCriteria}
            currentUserId={profile.id}
            currentUserName={profile.full_name ?? profile.email ?? "Shadow"}
            initialPanelRows={(sharedObservationResult.data ?? []) as Array<{
              panel_order: number;
              adjudicator_user_id: string;
              adjudicator_name: string;
              criterion_id: string | null;
              observation: string | null;
              updated_at: string | null;
            }>}
            ownComments={[]}
            ownScores={[]}
            panelApprovedCategoryIds={panelApprovedCategoryIds}
            panelFeedback={panelVisibleFeedback}
            panelReviewers={panelNarrativeReviewers}
            productionTitle={
              application.production_title ?? "Untitled production"
            }
            readOnly
            reviewStatus={reviewResult.data?.status ?? "draft"}
            scoreOptions={scoreChoices}
            canComment={false}
            canScore={false}
            observerMode
          />
        </>
      ) : workspaceMode === "access_notice" ? (
        <section className="panel advisory-read-only-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Application access</span>
              <h2>Review controls are not active for this school</h2>
              <p>
                Advisory Committee members may read every active application.
                Eligibility, ranges, panel comments, private visit details, and
                specialty awards become available after you select this
                timeslot or an Owner assigns you to its panel.
              </p>
            </div>
          </div>
          <div className="panel-body">
            <Link className="button button-secondary" href="/portal/schedule">
              Open scheduling
            </Link>
          </div>
        </section>
      ) : (
        <>
          {canEditAdvisoryScorecard ? (
            <form className="scorecard-form" id={scorecardFormId}>
              <AdjudicatorAutosave
                applicationId={id}
                disabled={readOnly}
              />
              {canComment ? (
                <>
                  <AdjudicationBrainDump
                    applicationId={id}
                    canComment
                    defaultValue={ownScorecard?.internal_notes}
                    fieldName="scorecard_internal_notes"
                    readOnly={readOnly}
                    scorecardId={ownScorecard?.id}
                    title="INITIAL BRAIN DUMP (INTERMISSION)"
                  />
                  <AdjudicationBrainDump
                    applicationId={id}
                    canComment
                    defaultValue={ownScorecard?.post_show_notes}
                    fieldName="scorecard_post_show_notes"
                    readOnly={readOnly}
                    scorecardId={ownScorecard?.id}
                    title="INITIAL BRAIN DUMP (POST SHOW)"
                  />
                </>
              ) : null}
              {narrativeCategories.map((category) => {
                const proposal = proposalByCategoryId.get(category.id);

                return (
                  <span hidden key={category.id}>
                    <input
                      name={`category_decision_finalized_${category.id}`}
                      type="hidden"
                      value={
                        proposal &&
                        categoryDecisionApprovedForUser({
                          proposalStatus: proposal.status,
                          ownResponse:
                            ownApprovalByProposalId.get(proposal.id)?.response,
                        })
                          ? "1"
                          : "0"
                      }
                    />
                    <input
                      name={`score_range_start_${category.id}`}
                      type="hidden"
                      value={proposal?.range_min ?? ""}
                    />
                    {category.subject_label ? (
                      <input
                        name={`subject_name_${category.id}`}
                        type="hidden"
                        value={
                          categorySubjectDefaults[category.category_key] ||
                          (comments.find(
                            (comment) =>
                              comment.scorecard_id === ownScorecard?.id &&
                              comment.category_id === category.id,
                          )?.subject_name ?? "")
                        }
                      />
                    ) : null}
                  </span>
                );
              })}
              {panelReviewWorkspace}
            </form>
          ) : (
            panelReviewWorkspace
          )}

          {profile.role === "owner" ? (
            <SpecialtyAwardWorkspace
              applicationId={id}
              currentUserId={profile.id}
              recommendations={specialtyRows}
              role="owner"
            />
          ) : null}

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
