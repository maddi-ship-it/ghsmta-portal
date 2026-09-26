"use server";

import { revalidatePath } from "next/cache";

import { queuePanelReviewForOwnersIfReady } from "@/lib/adjudication-owner-review";
import { twoPointRangeFromStart } from "@/lib/adjudication-ranges";
import {
  categoryDecisionHasChanges,
  type CategoryDecision,
  type ExistingCategoryProposal,
} from "@/lib/adjudication-category-decisions";
import { requireProfile } from "@/lib/auth";
import { logEvent } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export type CategoryProposalSaveResult = {
  ok: boolean;
  error?: string;
  message?: string;
  changedCount?: number;
  attemptId?: string;
};

const ACTIVE_APPLICATION_ERROR = "The active application was not found.";

function numbersMatch(
  left: number | string | null,
  right: number | null,
) {
  if (left == null || right == null) return left == null && right == null;
  return Number(left) === right;
}

async function saveAssignedWorkspaceCategoryProposals({
  applicationId,
  actorId,
  actorRole,
  decisions,
}: {
  applicationId: string;
  actorId: string;
  actorRole: AppRole;
  decisions: CategoryDecision[];
}) {
  const admin = createAdminClient();
  const { data: application, error: applicationError } = await admin
    .from("applications")
    .select("id,form_version_id,is_archived")
    .eq("id", applicationId)
    .maybeSingle();

  if (applicationError) throw new Error(applicationError.message);
  if (!application || application.is_archived) {
    throw new Error("This application is no longer available for review.");
  }
  if (!application.form_version_id) {
    throw new Error("This application does not have a published form.");
  }

  const { data: formVersion, error: formVersionError } = await admin
    .from("application_form_versions")
    .select("scoring_rubric_id")
    .eq("id", application.form_version_id)
    .maybeSingle();

  if (formVersionError) throw new Error(formVersionError.message);
  if (!formVersion?.scoring_rubric_id) {
    throw new Error("No scoring rubric is assigned to this application.");
  }

  const { data: categoryRows, error: categoryError } = await admin
    .from("scoring_categories")
    .select("id")
    .eq("rubric_id", formVersion.scoring_rubric_id)
    .eq("active", true);

  if (categoryError) throw new Error(categoryError.message);
  const validCategoryIds = new Set(
    (categoryRows ?? []).map((category) => category.id),
  );
  const submittedCategoryIds = new Set(
    decisions.map((decision) => decision.category_id),
  );

  if (
    submittedCategoryIds.size !== decisions.length ||
    decisions.some((decision) => !validCategoryIds.has(decision.category_id))
  ) {
    throw new Error(
      "A submitted category does not belong to this application rubric.",
    );
  }

  const { data: existingRows, error: existingError } = await admin
    .from("adjudication_category_proposals")
    .select(
      "id,category_id,proposed_by,is_eligible,range_min,range_max,status,advisory_note,owner_override_note,approved_at",
    )
    .eq("application_id", applicationId)
    .in("category_id", [...submittedCategoryIds]);

  if (existingError) throw new Error(existingError.message);
  const existingByCategory = new Map(
    ((existingRows ?? []) as ExistingCategoryProposal[]).map((proposal) => [
      proposal.category_id,
      proposal,
    ]),
  );
  const changedCategoryIds = new Set<string>();
  const proposalRows = decisions.flatMap((decision) => {
    const existing = existingByCategory.get(decision.category_id);

    if (
      existing?.status === "overridden" &&
      actorRole !== "owner"
    ) {
      return [];
    }

    const ownerOverride =
      actorRole === "owner" && decision.owner_override;
    const ownerOverrideNote =
      actorRole === "owner" ? decision.owner_override_note : null;
    const decisionChanged =
      !existing ||
      existing.is_eligible !== decision.is_eligible ||
      !numbersMatch(existing.range_min, decision.range_min) ||
      !numbersMatch(existing.range_max, decision.range_max) ||
      existing.advisory_note !== decision.advisory_note ||
      (actorRole === "owner" &&
        existing.owner_override_note !== ownerOverrideNote) ||
      (ownerOverride && existing.status !== "overridden") ||
      (!ownerOverride && existing.status === "overridden");
    const nextStatus = ownerOverride
      ? "overridden"
      : existing && !decisionChanged
        ? existing.status
        : "proposed";

    if (decisionChanged) changedCategoryIds.add(decision.category_id);

    return [
      {
        application_id: applicationId,
        category_id: decision.category_id,
        proposed_by: actorId,
        is_eligible: decision.is_eligible,
        range_min: decision.range_min,
        range_max: decision.range_max,
        status: nextStatus,
        advisory_note: decision.advisory_note,
        owner_override_note: ownerOverrideNote,
        approved_at:
          nextStatus === "approved" ? (existing?.approved_at ?? null) : null,
      },
    ];
  });

  if (proposalRows.length === 0) return 0;

  const { data: savedRows, error: saveError } = await admin
    .from("adjudication_category_proposals")
    .upsert(proposalRows, { onConflict: "application_id,category_id" })
    .select("id,category_id");

  if (saveError) throw new Error(saveError.message);

  const changedProposalIds = (savedRows ?? [])
    .filter((proposal) => changedCategoryIds.has(proposal.category_id))
    .map((proposal) => proposal.id);

  if (changedProposalIds.length > 0) {
    const { error: approvalError } = await admin
      .from("adjudication_category_approvals")
      .delete()
      .in("proposal_id", changedProposalIds);

    if (approvalError) throw new Error(approvalError.message);

    const { data: assignments, error: assignmentError } = await admin
      .from("adjudicator_assignments")
      .select("adjudicator_user_id")
      .eq("application_id", applicationId)
      .eq("can_score", true)
      .is("removed_at", null);

    if (assignmentError) throw new Error(assignmentError.message);
    const recipientIds = [
      ...new Set(
        (assignments ?? []).map(
          (assignment) => assignment.adjudicator_user_id,
        ),
      ),
    ];

    if (recipientIds.length > 0) {
      const changedCount = changedCategoryIds.size;
      const { error: notificationError } = await admin
        .from("user_notifications")
        .insert(
          recipientIds.map((userId) => ({
            user_id: userId,
            notification_type: "category_approval_required",
            title: "Category decisions ready for review",
            body: `${changedCount} eligibility or two-point range decision${changedCount === 1 ? "" : "s"} updated.`,
            href: `/portal/adjudication/${applicationId}`,
            related_application_id: applicationId,
          })),
        );

      if (notificationError) {
        logEvent("warn", "adjudication.category_proposal_notification_failed", {
          applicationId,
          actorId,
          message: notificationError.message,
        });
      }
    }
  }

  return changedCategoryIds.size;
}

export async function saveAllCategoryProposals(
  applicationId: string,
  _previous: CategoryProposalSaveResult,
  formData: FormData,
): Promise<CategoryProposalSaveResult> {
  const profile = await requireProfile(["advisory_member", "owner"]);
  const attemptId = new Date().toISOString();
  const categoryIds = [
    ...new Set(
      formData
        .getAll("category_id")
        .map(String)
        .filter(Boolean),
    ),
  ];

  if (categoryIds.length === 0) {
    return { ok: false, error: "No categories were submitted.", attemptId };
  }

  const decisions: CategoryDecision[] = categoryIds.map((categoryId) => {
    const eligible = formData.get(`eligible_${categoryId}`) === "on";
    const rangeText = text(formData, `range_${categoryId}`);
    const range = eligible ? twoPointRangeFromStart(rangeText) : null;

    return {
      category_id: categoryId,
      is_eligible: eligible,
      range_min: range?.rangeMinimum ?? (eligible ? Number.NaN : null),
      range_max: range?.rangeMaximum ?? (eligible ? Number.NaN : null),
      advisory_note: text(formData, `note_${categoryId}`) || null,
      owner_override: formData.get(`override_${categoryId}`) === "on",
      owner_override_note:
        text(formData, `override_note_${categoryId}`) || null,
    };
  });

  const supabase = await createClient();
  const { data: canReview, error: accessError } = await supabase.rpc(
    "can_advisory_review_application",
    {
      p_application_id: applicationId,
      p_user_id: profile.id,
    },
  );

  if (accessError) {
    logEvent("error", "adjudication.category_proposal_access_check_failed", {
      applicationId,
      actorId: profile.id,
      message: accessError.message,
    });
    return {
      ok: false,
      error: "We couldn't confirm access to this review. Please try again.",
      attemptId,
    };
  }
  if (!canReview) {
    return {
      ok: false,
      error: "You are no longer assigned to review this application.",
      attemptId,
    };
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("adjudication_category_proposals")
    .select(
      "id,category_id,proposed_by,is_eligible,range_min,range_max,status,advisory_note,owner_override_note,approved_at",
    )
    .eq("application_id", applicationId)
    .in("category_id", categoryIds);

  if (existingError) {
    logEvent("error", "adjudication.category_proposal_load_failed", {
      applicationId,
      actorId: profile.id,
      code: existingError.code,
      message: existingError.message,
    });
    return {
      ok: false,
      error: "We couldn't load the existing category decisions. Please try again.",
      attemptId,
    };
  }

  const existingByCategory = new Map(
    ((existingRows ?? []) as ExistingCategoryProposal[]).map((proposal) => [
      proposal.category_id,
      proposal,
    ]),
  );
  const changedDecisions = decisions.filter((decision) =>
    categoryDecisionHasChanges(
      decision,
      existingByCategory.get(decision.category_id),
      profile.role,
    ),
  );

  if (
    changedDecisions.some(
      (decision) =>
        decision.is_eligible &&
        (!Number.isFinite(decision.range_min) ||
          !Number.isFinite(decision.range_max)),
    )
  ) {
    return {
      ok: false,
      error: "Each changed eligible category needs a valid two-point range.",
      attemptId,
    };
  }

  if (
    profile.role === "owner" &&
    changedDecisions.some(
      (decision) =>
        decision.owner_override && !decision.owner_override_note,
    )
  ) {
    return {
      ok: false,
      error: "Every Owner override needs an override note.",
      attemptId,
    };
  }

  if (changedDecisions.length === 0) {
    return {
      ok: true,
      changedCount: 0,
      message: "All category decisions are already up to date.",
      attemptId,
    };
  }

  const { data, error } = await supabase.rpc(
    "save_all_adjudication_category_proposals",
    {
      p_application_id: applicationId,
      p_decisions: changedDecisions,
    },
  );

  let changedCount = Number(data ?? 0);
  if (error) {
    if (error.message === ACTIVE_APPLICATION_ERROR) {
      try {
        changedCount = await saveAssignedWorkspaceCategoryProposals({
          applicationId,
          actorId: profile.id,
          actorRole: profile.role,
          decisions: changedDecisions,
        });
      } catch (fallbackError) {
        const message =
          fallbackError instanceof Error
            ? fallbackError.message
            : "Unable to save the category decisions.";
        logEvent("error", "adjudication.category_proposal_fallback_failed", {
          applicationId,
          actorId: profile.id,
          message,
        });
        return {
          ok: false,
          error: message,
          attemptId,
        };
      }
    } else {
      logEvent("error", "adjudication.category_proposal_save_failed", {
        applicationId,
        actorId: profile.id,
        code: error.code,
        message: error.message,
      });
      return {
        ok: false,
        error: error.message,
        attemptId,
      };
    }
  }

  try {
    await queuePanelReviewForOwnersIfReady(applicationId, profile.id);
  } catch (queueError) {
    logEvent("warn", "adjudication.owner_review_queue_check_failed", {
      applicationId,
      actorId: profile.id,
      message:
        queueError instanceof Error
          ? queueError.message
          : "Owner review queue check failed.",
    });
  }

  revalidatePath(`/portal/adjudication/${applicationId}`);
  return {
    ok: true,
    changedCount,
    message:
      changedCount === 0
        ? "All category decisions are already up to date."
        : `${changedCount} category decision${changedCount === 1 ? "" : "s"} saved.`,
    attemptId,
  };
}

export async function respondCategoryProposal(
  applicationId: string,
  proposalId: string,
  responseValue: string,
  commentFieldName: string,
  formData: FormData,
) {
  const profile = await requireProfile(["adjudicator", "advisory_member"]);
  const response =
    responseValue === "disputed" ? "disputed" : "approved";
  const comment =
    response === "disputed" ? text(formData, commentFieldName) : "";

  if (response === "disputed" && comment.length < 3) {
    throw new Error("Add a comment explaining the dispute.");
  }

  const supabase = await createClient();
  if (response === "disputed") {
    const { data: assignment, error: assignmentError } = await supabase
      .from("adjudicator_assignments")
      .select("can_comment")
      .eq("application_id", applicationId)
      .eq("adjudicator_user_id", profile.id)
      .is("removed_at", null)
      .maybeSingle();

    if (assignmentError) throw new Error(assignmentError.message);
    if (!assignment?.can_comment) {
      throw new Error("Commenting is disabled for this assignment.");
    }
  }

  const { error } = await supabase
    .from("adjudication_category_approvals")
    .upsert(
      {
        proposal_id: proposalId,
        adjudicator_user_id: profile.id,
        eligibility_approved: response === "approved",
        range_approved: response === "approved",
        response,
        comment: comment || null,
        responded_at: new Date().toISOString(),
      },
      { onConflict: "proposal_id,adjudicator_user_id" },
    );

  if (error) throw new Error(error.message);

  if (response === "disputed") {
    const { data: reviewers } = await supabase
      .from("profiles")
      .select("id")
      .in("role", ["advisory_member", "owner"])
      .eq("active", true);

    if ((reviewers ?? []).length > 0) {
      await supabase.from("user_notifications").insert(
        (reviewers ?? []).map((user) => ({
          user_id: user.id,
          notification_type: "category_proposal_disputed",
          title: "Category decision disputed",
          body: comment,
          href: `/portal/adjudication/${applicationId}`,
          related_application_id: applicationId,
        })),
      );
    }
  }

  await queuePanelReviewForOwnersIfReady(applicationId, profile.id);

  revalidatePath(`/portal/adjudication/${applicationId}`);
}

export async function submitPanelForOwnerReview(applicationId: string) {
  const profile = await requireProfile(["advisory_member", "owner"]);
  const result = await queuePanelReviewForOwnersIfReady(
    applicationId,
    profile.id,
  );
  if (result === "not_ready") {
    throw new Error(
      "Submit every scorecard and approve every category decision and final comment before sending this review to Owners.",
    );
  }
  revalidatePath(`/portal/adjudication/${applicationId}`);
}

export async function ownerUpdateAdjudicationReview(
  applicationId: string,
  formData: FormData,
) {
  const owner = await requireProfile(["owner"]);
  const status = text(formData, "status");
  if (!["owner_review", "returned", "released"].includes(status)) {
    throw new Error("Choose a valid review status.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("adjudication_reviews").upsert(
    {
      application_id: applicationId,
      status,
      owner_reviewed_by: owner.id,
      owner_reviewed_at: new Date().toISOString(),
      owner_note: text(formData, "owner_note") || null,
      returned_at: status === "returned" ? new Date().toISOString() : null,
    },
    { onConflict: "application_id" },
  );

  if (error) throw new Error(error.message);
  revalidatePath(`/portal/adjudication/${applicationId}`);
}

export async function saveSpecialtyAwardRecommendations(
  applicationId: string,
  formData: FormData,
) {
  await requireProfile(["advisory_member"]);

  const awardTypes = formData
    .getAll("award_type")
    .map(String)
    .filter(Boolean);

  const recommendations = awardTypes.map((awardType) => ({
    award_type: awardType,
    recommendation_status:
      text(formData, `recommendation_status_${awardType}`) ||
      "no_recommendation",
    song_title: text(formData, `song_title_${awardType}`) || null,
    explanation: text(formData, `explanation_${awardType}`) || null,
  }));

  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "save_specialty_award_recommendations",
    {
      p_application_id: applicationId,
      p_recommendations: recommendations,
      p_submit: formData.get("submit_recommendations") === "true",
    },
  );

  if (error) throw new Error(error.message);
  revalidatePath(`/portal/adjudication/${applicationId}`);
  revalidatePath("/portal/admin/reports");
}
