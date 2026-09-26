import "server-only";

import { isPanelNarrativeApprovalComplete } from "@/lib/panel-narrative";
import { createAdminClient } from "@/lib/supabase/admin";

export type OwnerReviewQueueResult =
  | "sent"
  | "already_sent"
  | "not_ready";

export async function queuePanelReviewForOwnersIfReady(
  applicationId: string,
  submittedBy: string,
): Promise<OwnerReviewQueueResult> {
  const admin = createAdminClient();
  const { data: application, error: applicationError } = await admin
    .from("applications")
    .select("form_version_id,school_name,production_title")
    .eq("id", applicationId)
    .single();

  if (applicationError || !application) {
    throw new Error(applicationError?.message ?? "Application not found.");
  }

  const { data: formVersion, error: formVersionError } = application.form_version_id
    ? await admin
        .from("application_form_versions")
        .select("scoring_rubric_id")
        .eq("id", application.form_version_id)
        .single()
    : { data: null, error: null };

  if (formVersionError) throw new Error(formVersionError.message);
  if (!formVersion?.scoring_rubric_id) return "not_ready";

  const [
    categoriesResult,
    assignmentsResult,
    scorecardsResult,
    proposalsResult,
    feedbackResult,
    reviewResult,
  ] = await Promise.all([
    admin
      .from("scoring_categories")
      .select("id")
      .eq("rubric_id", formVersion.scoring_rubric_id)
      .eq("active", true),
    admin
      .from("adjudicator_assignments")
      .select("id,adjudicator_user_id,can_score,can_comment")
      .eq("application_id", applicationId)
      .is("removed_at", null),
    admin
      .from("adjudication_scorecards")
      .select("assignment_id,status")
      .eq("application_id", applicationId),
    admin
      .from("adjudication_category_proposals")
      .select("category_id,status")
      .eq("application_id", applicationId),
    admin
      .from("adjudication_panel_feedback")
      .select("category_id,status,final_comment,assigned_to,approved_by")
      .eq("application_id", applicationId),
    admin
      .from("adjudication_reviews")
      .select("status")
      .eq("application_id", applicationId)
      .maybeSingle(),
  ]);

  const firstError = [
    categoriesResult.error,
    assignmentsResult.error,
    scorecardsResult.error,
    proposalsResult.error,
    feedbackResult.error,
    reviewResult.error,
  ].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  const categories = categoriesResult.data ?? [];
  const assignments = assignmentsResult.data ?? [];
  const scoringAssignments = assignments.filter(
    (assignment) => assignment.can_score,
  );
  const panelReviewerIds = new Set(
    assignments
      .filter((assignment) => assignment.can_comment)
      .map((assignment) => assignment.adjudicator_user_id),
  );
  if (categories.length === 0 || scoringAssignments.length === 0) {
    return "not_ready";
  }

  const submittedAssignments = new Set(
    (scorecardsResult.data ?? [])
      .filter((scorecard) => ["submitted", "locked"].includes(scorecard.status))
      .map((scorecard) => scorecard.assignment_id),
  );
  if (
    scoringAssignments.some(
      (assignment) => !submittedAssignments.has(assignment.id),
    )
  ) {
    return "not_ready";
  }

  const proposalByCategory = new Map(
    (proposalsResult.data ?? []).map((proposal) => [proposal.category_id, proposal]),
  );
  if (
    categories.some((category) => {
      const proposal = proposalByCategory.get(category.id);
      return !proposal || !["approved", "overridden"].includes(proposal.status);
    })
  ) {
    return "not_ready";
  }

  const feedbackByCategory = new Map(
    (feedbackResult.data ?? []).map((feedback) => [feedback.category_id, feedback]),
  );
  if (
    categories.some((category) => {
      const feedback = feedbackByCategory.get(category.id);
      return (
        feedback?.status !== "approved" ||
        !feedback.final_comment?.trim() ||
        !isPanelNarrativeApprovalComplete({
          assignedTo: feedback.assigned_to,
          approvedBy: feedback.approved_by,
          panelReviewerIds,
        })
      );
    })
  ) {
    return "not_ready";
  }

  if (["ready_for_owner", "owner_review", "released"].includes(reviewResult.data?.status ?? "")) {
    return "already_sent";
  }

  const now = new Date().toISOString();
  const { error: saveReviewError } = await admin
    .from("adjudication_reviews")
    .upsert(
      {
        application_id: applicationId,
        status: "ready_for_owner",
        submitted_by: submittedBy,
        submitted_at: now,
        returned_at: null,
      },
      { onConflict: "application_id" },
    );
  if (saveReviewError) throw new Error(saveReviewError.message);

  const { error: activityError } = await admin.from("owner_activity_log").insert({
    activity_type: "adjudication_ready_for_owner",
    title: "Adjudication ready for Owner review",
    detail: "All scorecards, category decisions, and panel narratives are approved.",
    actor_id: submittedBy,
    application_id: applicationId,
  });
  if (activityError) throw new Error(activityError.message);

  const { data: owners, error: ownerError } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "owner")
    .eq("active", true);
  if (ownerError) throw new Error(ownerError.message);

  if ((owners ?? []).length > 0) {
    const { error: notificationError } = await admin
      .from("user_notifications")
      .insert(
        (owners ?? []).map((owner) => ({
          user_id: owner.id,
          notification_type: "adjudication_ready_for_owner",
          title: "Adjudication ready for review",
          body: `${application.school_name} — ${application.production_title ?? "Untitled production"}`,
          href: `/portal/adjudication/${applicationId}`,
          related_application_id: applicationId,
        })),
      );
    if (notificationError) throw new Error(notificationError.message);
  }

  return "sent";
}
