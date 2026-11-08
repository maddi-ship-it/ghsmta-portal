import "server-only";

import { OVERALL_PRODUCTION_CATEGORY_KEY } from "@/lib/adjudication-overall-score";
import type { OwnerPostAdjudicationVisit } from "@/lib/owner-dashboard-actions";
import { richTextHasContent } from "@/lib/rich-text";
import {
  readScheduleWorkflowChecklist,
  resolveScheduleWorkflowChecklist,
} from "@/lib/schedule-workflow-checklist";
import { createAdminClient } from "@/lib/supabase/admin";

type DashboardApplication = {
  id: string;
  form_version_id: string | null;
  current_stage_id: string | null;
  school_name: string;
  production_title: string | null;
  form_data: Record<string, unknown> | null;
};

export async function loadOwnerPostAdjudicationVisits(
  applications: DashboardApplication[],
): Promise<OwnerPostAdjudicationVisit[]> {
  if (applications.length === 0) return [];

  const admin = createAdminClient();
  const applicationIds = applications.map((application) => application.id);
  const formVersionIds = [
    ...new Set(
      applications
        .map((application) => application.form_version_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [
    bookingResult,
    formVersionResult,
    releaseResult,
    assignmentResult,
    scorecardResult,
    scoreabilityResult,
    feedbackResult,
    channelResult,
  ] = await Promise.all([
    admin
      .from("schedule_school_bookings")
      .select("slot_id,application_id,approval_status")
      .in("application_id", applicationIds)
      .eq("approval_status", "confirmed"),
    formVersionIds.length
      ? admin
          .from("application_form_versions")
          .select("id,scoring_rubric_id")
          .in("id", formVersionIds)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from("adjudication_releases")
      .select("application_id,feedback_snapshot")
      .in("application_id", applicationIds),
    admin
      .from("adjudicator_assignments")
      .select("id,application_id,can_score,can_comment")
      .in("application_id", applicationIds)
      .is("removed_at", null),
    admin
      .from("adjudication_scorecards")
      .select("id,assignment_id,application_id,rubric_id,status")
      .in("application_id", applicationIds),
    admin
      .from("adjudication_category_scoreability")
      .select("application_id,category_id,is_scoreable")
      .in("application_id", applicationIds),
    admin
      .from("adjudication_panel_feedback")
      .select("application_id,category_id,final_comment")
      .in("application_id", applicationIds),
    admin
      .from("chat_channels")
      .select("id,application_id")
      .in("application_id", applicationIds)
      .eq("channel_type", "school_dm")
      .eq("active", true),
  ]);

  const initialError = [
    bookingResult.error,
    formVersionResult.error,
    releaseResult.error,
    assignmentResult.error,
    scorecardResult.error,
    scoreabilityResult.error,
    feedbackResult.error,
    channelResult.error,
  ].find(Boolean);
  if (initialError) throw new Error(initialError.message);

  const bookings = bookingResult.data ?? [];
  const slotIds = [...new Set(bookings.map((booking) => booking.slot_id))];
  const scorecards = scorecardResult.data ?? [];
  const rubricIds = [
    ...new Set([
      ...(formVersionResult.data ?? [])
        .map((version) => version.scoring_rubric_id)
        .filter((id): id is string => Boolean(id)),
      ...scorecards
        .map((scorecard) => scorecard.rubric_id)
        .filter((id): id is string => Boolean(id)),
    ]),
  ];

  const [slotResult, stageResult, categoryResult, scoreResult] =
    await Promise.all([
      slotIds.length
        ? admin
            .from("schedule_slots")
            .select("id,starts_at,ends_at")
            .in("id", slotIds)
        : Promise.resolve({ data: [], error: null }),
      formVersionIds.length
        ? admin
            .from("application_stages")
            .select("id,form_version_id,stage_key")
            .in("form_version_id", formVersionIds)
            .eq("stage_key", "section_c_postproduction")
        : Promise.resolve({ data: [], error: null }),
      rubricIds.length
        ? admin
            .from("scoring_categories")
            .select("id,rubric_id,category_key")
            .in("rubric_id", rubricIds)
            .eq("active", true)
        : Promise.resolve({ data: [], error: null }),
      scorecards.length
        ? admin
            .from("adjudication_scores")
            .select("scorecard_id,criterion_id,score,observation")
            .in(
              "scorecard_id",
              scorecards.map((scorecard) => scorecard.id),
            )
        : Promise.resolve({ data: [], error: null }),
    ]);

  const relatedError = [
    slotResult.error,
    stageResult.error,
    categoryResult.error,
    scoreResult.error,
  ].find(Boolean);
  if (relatedError) throw new Error(relatedError.message);

  const stages = stageResult.data ?? [];
  const categories = categoryResult.data ?? [];
  const [progressResult, criterionResult] = await Promise.all([
    stages.length
      ? admin
          .from("application_stage_progress")
          .select("application_id,stage_id,status")
          .in("application_id", applicationIds)
          .in(
            "stage_id",
            stages.map((stage) => stage.id),
          )
      : Promise.resolve({ data: [], error: null }),
    categories.length
      ? admin
          .from("scoring_criteria")
          .select("id,category_id")
          .in(
            "category_id",
            categories.map((category) => category.id),
          )
          .eq("active", true)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const finalError = progressResult.error ?? criterionResult.error;
  if (finalError) throw new Error(finalError.message);

  const applicationById = new Map(
    applications.map((application) => [application.id, application]),
  );
  const slotById = new Map(
    (slotResult.data ?? []).map((slot) => [slot.id, slot]),
  );
  const rubricByFormVersion = new Map(
    (formVersionResult.data ?? []).map((version) => [
      version.id,
      version.scoring_rubric_id,
    ]),
  );
  const sectionCStageByFormVersion = new Map(
    stages.map((stage) => [stage.form_version_id, stage]),
  );
  const sectionCProgressByApplication = new Map(
    (progressResult.data ?? []).map((progress) => [
      progress.application_id,
      progress,
    ]),
  );
  const releaseByApplication = new Map(
    (releaseResult.data ?? []).map((release) => [release.application_id, release]),
  );
  const chatByApplication = new Map(
    (channelResult.data ?? []).map((channel) => [channel.application_id, channel.id]),
  );
  const categoriesByRubric = new Map<string, typeof categories>();
  for (const category of categories) {
    const list = categoriesByRubric.get(category.rubric_id) ?? [];
    list.push(category);
    categoriesByRubric.set(category.rubric_id, list);
  }
  const criterionIdsByCategory = new Map<string, string[]>();
  for (const criterion of criterionResult.data ?? []) {
    const list = criterionIdsByCategory.get(criterion.category_id) ?? [];
    list.push(criterion.id);
    criterionIdsByCategory.set(criterion.category_id, list);
  }
  const unscoreableByApplication = new Map<string, Set<string>>();
  for (const decision of scoreabilityResult.data ?? []) {
    if (decision.is_scoreable !== false) continue;
    const set = unscoreableByApplication.get(decision.application_id) ?? new Set();
    set.add(decision.category_id);
    unscoreableByApplication.set(decision.application_id, set);
  }
  const assignmentsByApplication = new Map<
    string,
    typeof assignmentResult.data
  >();
  for (const assignment of assignmentResult.data ?? []) {
    if (!assignment.can_score && !assignment.can_comment) continue;
    const list = assignmentsByApplication.get(assignment.application_id) ?? [];
    list.push(assignment);
    assignmentsByApplication.set(assignment.application_id, list);
  }
  const scorecardByAssignment = new Map(
    scorecards.map((scorecard) => [scorecard.assignment_id, scorecard]),
  );
  const scoreByCardAndCriterion = new Map(
    (scoreResult.data ?? []).map((score) => [
      `${score.scorecard_id}:${score.criterion_id}`,
      score,
    ]),
  );
  const feedbackByApplicationAndCategory = new Map(
    (feedbackResult.data ?? []).map((feedback) => [
      `${feedback.application_id}:${feedback.category_id}`,
      feedback,
    ]),
  );

  return bookings.flatMap((booking) => {
    const application = applicationById.get(booking.application_id);
    const slot = slotById.get(booking.slot_id);
    if (!application || !slot) return [];

    const checklist = readScheduleWorkflowChecklist(application.form_data);
    const sectionCStage = application.form_version_id
      ? sectionCStageByFormVersion.get(application.form_version_id)
      : null;
    const sectionCProgress = sectionCProgressByApplication.get(application.id);
    const release = releaseByApplication.get(application.id);
    const resolvedChecklist = resolveScheduleWorkflowChecklist(
      application.form_data,
      {
        releasedFeedbackCount: Array.isArray(release?.feedback_snapshot)
          ? release.feedback_snapshot.length
          : 0,
        sectionCStatus: sectionCProgress?.status ?? null,
      },
    );
    const assignments = assignmentsByApplication.get(application.id) ?? [];
    const submittedScorecards = assignments.filter((assignment) => {
      const scorecard = scorecardByAssignment.get(assignment.id);
      return scorecard
        ? ["submitted", "locked"].includes(scorecard.status)
        : false;
    }).length;
    const panelCellsComplete =
      assignments.length > 0 &&
      assignments.every((assignment) => {
        const scorecard = scorecardByAssignment.get(assignment.id);
        if (!scorecard) return false;

        const unscoreable = unscoreableByApplication.get(application.id) ?? new Set();
        const rubricCategories = categoriesByRubric.get(scorecard.rubric_id) ?? [];
        const criterionIds = rubricCategories
          .filter((category) => !unscoreable.has(category.id))
          .flatMap((category) => criterionIdsByCategory.get(category.id) ?? []);
        if (criterionIds.length === 0) return false;

        return criterionIds.every((criterionId) => {
          const score = scoreByCardAndCriterion.get(
            `${scorecard.id}:${criterionId}`,
          );
          if (!score) return false;
          if (assignment.can_score && score.score == null) return false;
          if (
            assignment.can_comment &&
            !richTextHasContent(score.observation)
          ) {
            return false;
          }
          return true;
        });
      });
    const rubricId = application.form_version_id
      ? rubricByFormVersion.get(application.form_version_id)
      : null;
    const unscoreable = unscoreableByApplication.get(application.id) ?? new Set();
    const finalCommentCategoryIds = rubricId
      ? (categoriesByRubric.get(rubricId) ?? [])
          .filter(
            (category) =>
              category.category_key !== OVERALL_PRODUCTION_CATEGORY_KEY &&
              !unscoreable.has(category.id),
          )
          .map((category) => category.id)
      : [];
    const finalCommentsGenerated =
      finalCommentCategoryIds.length > 0 &&
      finalCommentCategoryIds.every((categoryId) =>
        richTextHasContent(
          feedbackByApplicationAndCategory.get(
            `${application.id}:${categoryId}`,
          )?.final_comment,
        ),
      );
    const sectionCStarted = Boolean(
      resolvedChecklist.moved_to_section_c ||
        (sectionCStage && application.current_stage_id === sectionCStage.id),
    );

    return [
      {
        applicationId: application.id,
        schoolName: application.school_name,
        productionTitle: application.production_title,
        startsAt: slot.starts_at,
        endsAt: slot.ends_at,
        sectionCStageId: sectionCStage?.id ?? null,
        sectionCStarted,
        sectionCComplete: resolvedChecklist.section_c_complete,
        sectionCReminderSent: checklist.section_c_reminder_sent,
        pickSixSent: resolvedChecklist.pick_six_sent,
        panelCellsComplete,
        submittedScorecards,
        expectedScorecards: assignments.length,
        finalCommentsGenerated,
        schoolChatChannelId: chatByApplication.get(application.id) ?? null,
      },
    ];
  });
}
