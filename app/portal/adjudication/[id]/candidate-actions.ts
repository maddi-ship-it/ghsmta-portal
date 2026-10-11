"use server";

import { revalidatePath } from "next/cache";

import {
  ACTING_CANDIDATE_REVIEW_ACTIONS,
  buildActingCandidateSchoolMessage,
  changedActingCandidateSlots,
  createInitialActingCandidateReviewState,
  extractActingCandidates,
  parseActingCandidateReviewState,
  type ActingCandidate,
  type ActingCandidateApproval,
  type ActingCandidateReviewState,
  type ActingCandidateSlot,
} from "@/lib/acting-candidate-review";
import { buildApplicationReferencePanels } from "@/lib/application-reference-panels";
import { requireProfile } from "@/lib/auth";
import { sendChatEmailNotifications } from "@/lib/chat/email-notifications";
import { logEvent } from "@/lib/observability";
import { portalSiteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type {
  Application,
  ApplicationAnswer,
  ApplicationQuestion,
} from "@/lib/types";

type CandidateResponse = "approved" | "changes_requested";

const CANDIDATE_SLOTS: ActingCandidateSlot[] = [
  "leading_actress",
  "leading_actor",
  "supporting_performer_a",
  "supporting_performer_b",
  "featured_performer",
];

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function formatDeadline(value: string | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

async function loadActingCandidateContext(applicationId: string) {
  const admin = createAdminClient();
  const { data: application, error: applicationError } = await admin
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();

  if (applicationError) throw new Error(applicationError.message);
  if (!application || application.is_archived) {
    throw new Error("This application is no longer available for review.");
  }

  const [questionsResult, answersResult, auditResult, assignmentsResult] =
    await Promise.all([
      application.form_version_id
        ? admin
            .from("application_questions")
            .select("*")
            .eq("form_version_id", application.form_version_id)
        : Promise.resolve({ data: [], error: null }),
      admin
        .from("application_answers")
        .select("*")
        .eq("application_id", applicationId),
      admin
        .from("application_audit_log")
        .select("new_record,created_at")
        .eq("subject_application_id", applicationId)
        .in("action", [...ACTING_CANDIDATE_REVIEW_ACTIONS])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("adjudicator_assignments")
        .select("adjudicator_user_id")
        .eq("application_id", applicationId)
        .is("removed_at", null),
    ]);

  const firstError = [
    questionsResult.error,
    answersResult.error,
    auditResult.error,
    assignmentsResult.error,
  ].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  const panelMemberIds = [
    ...new Set(
      (assignmentsResult.data ?? []).map(
        (assignment) => assignment.adjudicator_user_id,
      ),
    ),
  ];
  const { data: profiles, error: profilesError } = panelMemberIds.length
    ? await admin
        .from("profiles")
        .select("id,role,active")
        .in("id", panelMemberIds)
        .eq("active", true)
        .in("role", ["adjudicator", "advisory_member"])
    : { data: [], error: null };
  if (profilesError) throw new Error(profilesError.message);

  const activePanelMemberIds = (profiles ?? []).map((profile) => profile.id);
  const panels = buildApplicationReferencePanels({
    application: application as Application,
    questions: (questionsResult.data ?? []) as ApplicationQuestion[],
    answers: (answersResult.data ?? []) as ApplicationAnswer[],
  });
  const originalCandidates = extractActingCandidates(panels);
  const savedState = parseActingCandidateReviewState(
    auditResult.data?.new_record,
  );

  return {
    admin,
    application: application as Application,
    activePanelMemberIds,
    originalCandidates,
    state:
      savedState ??
      createInitialActingCandidateReviewState({
        applicationId,
        candidates: originalCandidates,
        requiredApproverIds: activePanelMemberIds,
      }),
  };
}

async function saveState({
  applicationId,
  actorId,
  action,
  previousState,
  nextState,
}: {
  applicationId: string;
  actorId: string;
  action: (typeof ACTING_CANDIDATE_REVIEW_ACTIONS)[number];
  previousState: ActingCandidateReviewState;
  nextState: ActingCandidateReviewState;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("application_audit_log").insert({
    application_id: applicationId,
    subject_application_id: applicationId,
    actor_user_id: actorId,
    action,
    old_record: previousState,
    new_record: nextState,
  });
  if (error) throw new Error(error.message);
}

function submittedCandidates(
  formData: FormData,
  existing: ActingCandidate[],
) {
  const existingBySlot = new Map(
    existing.map((candidate) => [candidate.slot, candidate]),
  );

  return CANDIDATE_SLOTS.map((slot) => {
    const current = existingBySlot.get(slot);
    const candidate: ActingCandidate = {
      slot,
      label: current?.label ?? slot.replaceAll("_", " "),
      name: text(formData, `candidate_${slot}_name`),
      pronouns: text(formData, `candidate_${slot}_pronouns`),
      role: text(formData, `candidate_${slot}_role`),
      gradeLevel: text(formData, `candidate_${slot}_grade_level`),
    };
    if (!candidate.name || !candidate.role) {
      throw new Error(
        `${candidate.label} needs both a candidate name and a role.`,
      );
    }
    return candidate;
  });
}

async function confirmAdvisoryAccess(applicationId: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "can_advisory_review_application",
    { p_application_id: applicationId, p_user_id: userId },
  );
  if (error || !data) {
    throw new Error("You are no longer assigned to review this school.");
  }
}

export async function submitActingCandidateReview(
  applicationId: string,
  formData: FormData,
) {
  const profile = await requireProfile(["advisory_member"]);
  await confirmAdvisoryAccess(applicationId, profile.id);

  const context = await loadActingCandidateContext(applicationId);
  if (context.activePanelMemberIds.length === 0) {
    throw new Error(
      "Assign the adjudication panel before sending acting candidates for approval.",
    );
  }

  const candidates = submittedCandidates(formData, context.state.candidates);
  const now = new Date().toISOString();
  const currentUserApproval: ActingCandidateApproval = {
    userId: profile.id,
    response: "approved",
    comment: null,
    respondedAt: now,
  };
  let nextState: ActingCandidateReviewState = {
    ...context.state,
    revision: context.state.revision + 1,
    status: "pending",
    originalCandidates: context.originalCandidates,
    candidates,
    changedSlots: changedActingCandidateSlots(
      context.originalCandidates,
      candidates,
    ),
    requiredApproverIds: context.activePanelMemberIds,
    approvals: context.activePanelMemberIds.includes(profile.id)
      ? [currentUserApproval]
      : [],
    coordinatorId: profile.id,
    coordinatorName:
      profile.full_name?.trim() || profile.email || "GHSMTA Advisory Committee",
    submittedAt: now,
    approvedAt: null,
    schoolMessageId: null,
    sectionOpened: false,
    pronunciationReuploadRequired: false,
  };
  const unanimouslyApproved = nextState.requiredApproverIds.every((userId) =>
    nextState.approvals.some(
      (approval) =>
        approval.userId === userId && approval.response === "approved",
    ),
  );
  if (unanimouslyApproved) {
    const publication = await publishApprovedCandidates({
      applicationId,
      actorId: profile.id,
      state: { ...nextState, status: "approved", approvedAt: now },
    });
    nextState = {
      ...nextState,
      status: "approved",
      approvedAt: now,
      schoolMessageId: publication.postId,
      sectionOpened: publication.sectionOpened,
      pronunciationReuploadRequired: nextState.changedSlots.length > 0,
    };
  }

  await saveState({
    applicationId,
    actorId: profile.id,
    action: unanimouslyApproved
      ? "acting_candidates_approved"
      : context.state.revision === 0
        ? "acting_candidates_submitted"
        : "acting_candidates_revised",
    previousState: context.state,
    nextState,
  });

  const recipientIds = context.activePanelMemberIds.filter(
    (userId) => userId !== profile.id,
  );
  if (recipientIds.length > 0) {
    const { error } = await context.admin.from("user_notifications").insert(
      recipientIds.map((userId) => ({
        user_id: userId,
        notification_type: "acting_candidates_approval_required",
        title: "Acting candidates ready for approval",
        body: `${context.application.school_name} — review revision ${nextState.revision} in Review All Categories.`,
        href: `/portal/adjudication/${applicationId}`,
        related_application_id: applicationId,
      })),
    );
    if (error) {
      logEvent("warn", "acting_candidates.notification_failed", {
        applicationId,
        message: error.message,
      });
    }
  }

  revalidatePath(`/portal/adjudication/${applicationId}`);
  revalidatePath("/portal/notifications");
}

async function publishApprovedCandidates({
  applicationId,
  actorId,
  state,
}: {
  applicationId: string;
  actorId: string;
  state: ActingCandidateReviewState;
}) {
  const admin = createAdminClient();
  const { data: application, error: applicationError } = await admin
    .from("applications")
    .select(
      "id,applicant_user_id,external_applicant_name,school_name,production_title,form_version_id",
    )
    .eq("id", applicationId)
    .single();
  if (applicationError) throw new Error(applicationError.message);

  const [{ data: stage, error: stageError }, { data: channel, error: channelError }] =
    await Promise.all([
      application.form_version_id
        ? admin
            .from("application_stages")
            .select("id,title,closes_at")
            .eq("form_version_id", application.form_version_id)
            .eq("stage_key", "section_c_postproduction")
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin
        .from("chat_channels")
        .select("id")
        .eq("application_id", applicationId)
        .eq("channel_type", "school_dm")
        .eq("active", true)
        .maybeSingle(),
    ]);
  if (stageError) throw new Error(stageError.message);
  if (channelError) throw new Error(channelError.message);
  if (!channel) {
    throw new Error("The school messaging channel could not be found.");
  }

  const siteUrl = portalSiteUrl();
  const body = buildActingCandidateSchoolMessage({
    contactName: application.external_applicant_name,
    coordinatorName: state.coordinatorName ?? "GHSMTA Advisory Committee",
    candidates: state.candidates,
    changedSlots: state.changedSlots,
    sectionDeadline: formatDeadline(stage?.closes_at),
    sectionOpened: Boolean(stage),
    referenceFilesUrl: `${siteUrl}/portal/reference-documents`,
    schoolFilesUrl: `${siteUrl}/portal/files`,
  });
  const subject = state.changedSlots.length
    ? "Section C opened: acting candidate changes approved"
    : "Section C opened: acting candidates confirmed";
  const authorId = state.coordinatorId ?? actorId;
  const { data: post, error: postError } = await admin
    .from("chat_posts")
    .insert({
      channel_id: channel.id,
      author_id: authorId,
      subject,
      body,
    })
    .select("id")
    .single();
  if (postError) throw new Error(postError.message);

  if (stage) {
    const now = new Date().toISOString();
    const [{ error: progressError }, { error: applicationUpdateError }] =
      await Promise.all([
        admin.from("application_stage_progress").upsert(
          {
            application_id: applicationId,
            stage_id: stage.id,
            status: "in_progress",
            started_at: now,
          },
          { onConflict: "application_id,stage_id" },
        ),
        admin
          .from("applications")
          .update({ current_stage_id: stage.id, status: "draft" })
          .eq("id", applicationId),
      ]);
    if (progressError) throw new Error(progressError.message);
    if (applicationUpdateError) throw new Error(applicationUpdateError.message);
  }

  try {
    await sendChatEmailNotifications({
      channelId: channel.id,
      messageId: post.id,
      messageKind: "post",
      authorId,
      authorName: state.coordinatorName ?? "GHSMTA Advisory Committee",
      subject,
      body,
    });
  } catch (error) {
    logEvent("warn", "acting_candidates.school_email_failed", {
      applicationId,
      message: error instanceof Error ? error.message : "Unknown email error",
    });
  }

  return { postId: post.id, sectionOpened: Boolean(stage) };
}

export async function respondActingCandidateReview(
  applicationId: string,
  response: CandidateResponse,
  formData: FormData,
) {
  const profile = await requireProfile(["adjudicator", "advisory_member"]);
  const context = await loadActingCandidateContext(applicationId);
  const state = context.state;

  if (!state.requiredApproverIds.includes(profile.id)) {
    throw new Error("You are not part of this candidate approval panel.");
  }
  if (state.status === "draft") {
    throw new Error("The Advisory Committee has not submitted a roster yet.");
  }
  if (state.status === "approved") return;

  const comment = text(formData, "candidate_change_request");
  if (response === "changes_requested" && comment.length < 3) {
    throw new Error("Add a short explanation of the requested candidate change.");
  }

  const now = new Date().toISOString();
  const approvals = [
    ...state.approvals.filter((approval) => approval.userId !== profile.id),
    {
      userId: profile.id,
      response,
      comment: comment || null,
      respondedAt: now,
    } satisfies ActingCandidateApproval,
  ];
  const unanimouslyApproved = state.requiredApproverIds.every((userId) =>
    approvals.some(
      (approval) =>
        approval.userId === userId && approval.response === "approved",
    ),
  );
  let schoolMessageId: string | null = null;
  let sectionOpened = false;
  if (unanimouslyApproved) {
    const publication = await publishApprovedCandidates({
      applicationId,
      actorId: profile.id,
      state: { ...state, approvals, approvedAt: now },
    });
    schoolMessageId = publication.postId;
    sectionOpened = publication.sectionOpened;
  }

  const nextState: ActingCandidateReviewState = {
    ...state,
    status: unanimouslyApproved
      ? "approved"
      : response === "changes_requested" ||
          approvals.some((approval) => approval.response === "changes_requested")
        ? "changes_requested"
        : "pending",
    approvals,
    approvedAt: unanimouslyApproved ? now : null,
    schoolMessageId,
    sectionOpened,
    pronunciationReuploadRequired:
      unanimouslyApproved && state.changedSlots.length > 0,
  };

  await saveState({
    applicationId,
    actorId: profile.id,
    action: unanimouslyApproved
      ? "acting_candidates_approved"
      : "acting_candidates_response",
    previousState: state,
    nextState,
  });

  if (response === "changes_requested" && state.coordinatorId) {
    const { error } = await context.admin.from("user_notifications").insert({
      user_id: state.coordinatorId,
      notification_type: "acting_candidates_changes_requested",
      title: "Acting candidate changes requested",
      body: `${context.application.school_name} — review the panel note in Review All Categories.`,
      href: `/portal/adjudication/${applicationId}`,
      related_application_id: applicationId,
    });
    if (error) {
      logEvent("warn", "acting_candidates.change_notification_failed", {
        applicationId,
        message: error.message,
      });
    }
  }

  revalidatePath(`/portal/adjudication/${applicationId}`);
  revalidatePath(`/portal/applications/${applicationId}`);
  revalidatePath("/portal/chat");
  revalidatePath("/portal/files");
  revalidatePath("/portal/notifications");
}
