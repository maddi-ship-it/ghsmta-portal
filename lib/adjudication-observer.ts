import type { SupabaseClient } from "@supabase/supabase-js";

export type AdjudicationObserverPanelRow = {
  panel_order: number;
  adjudicator_user_id: string;
  adjudicator_name: string;
  criterion_id: string | null;
  observation: string | null;
  updated_at: string | null;
};

export type AdjudicationObserverProposal = {
  id: string;
  category_id: string;
  is_eligible: boolean;
  range_min: number | null;
  range_max: number | null;
  status: string;
  advisory_note: string | null;
};

export type AdjudicationObserverApproval = {
  proposal_id: string;
  adjudicator_user_id: string;
  response: string;
  comment: string | null;
};

export type AdjudicationObserverSnapshot = {
  panelRows: AdjudicationObserverPanelRow[];
  proposals: AdjudicationObserverProposal[];
  approvals: AdjudicationObserverApproval[];
};

type ObserverAccess = {
  allowed: boolean;
  scheduledShadow: boolean;
  readOnlyAssignment: boolean;
};

type ObserverAssignmentRow = {
  id: string;
  adjudicator_user_id: string;
  assigned_at: string;
  can_score: boolean;
  can_comment: boolean;
};

type ObserverProfileRow = {
  id: string;
  full_name: string | null;
};

type ObserverScorecardRow = {
  id: string;
  adjudicator_user_id: string;
};

type ObserverScoreRow = {
  scorecard_id: string;
  criterion_id: string;
  observation: string | null;
  updated_at: string | null;
};

export function buildAdjudicationObserverPanelRows({
  assignments,
  profiles,
  scorecards,
  scores,
}: {
  assignments: ObserverAssignmentRow[];
  profiles: ObserverProfileRow[];
  scorecards: ObserverScorecardRow[];
  scores: ObserverScoreRow[];
}): AdjudicationObserverPanelRow[] {
  const profileNameById = new Map(
    profiles.map((profile) => [
      profile.id,
      profile.full_name?.trim() || null,
    ]),
  );
  const scorecardUserById = new Map(
    scorecards.map((scorecard) => [
      scorecard.id,
      scorecard.adjudicator_user_id,
    ]),
  );
  const scoresByUserId = new Map<string, ObserverScoreRow[]>();

  for (const score of scores) {
    const userId = scorecardUserById.get(score.scorecard_id);
    if (!userId) continue;
    const userScores = scoresByUserId.get(userId) ?? [];
    userScores.push(score);
    scoresByUserId.set(userId, userScores);
  }

  return assignments.flatMap<AdjudicationObserverPanelRow>((assignment, index) => {
    const panelOrder = index + 1;
    const userScores = scoresByUserId.get(assignment.adjudicator_user_id) ?? [];
    const adjudicatorName =
      profileNameById.get(assignment.adjudicator_user_id) ??
      `Adjudicator ${panelOrder}`;

    if (userScores.length === 0) {
      return [
        {
          panel_order: panelOrder,
          adjudicator_user_id: assignment.adjudicator_user_id,
          adjudicator_name: adjudicatorName,
          criterion_id: null,
          observation: null,
          updated_at: null,
        },
      ];
    }

    return userScores.map((score) => ({
      panel_order: panelOrder,
      adjudicator_user_id: assignment.adjudicator_user_id,
      adjudicator_name: adjudicatorName,
      criterion_id: score.criterion_id,
      observation: score.observation,
      updated_at: score.updated_at,
    }));
  });
}

export async function resolveAdjudicationObserverAccess({
  admin,
  applicationId,
  userId,
}: {
  admin: SupabaseClient;
  applicationId: string;
  userId: string;
}): Promise<ObserverAccess> {
  const [bookingResult, assignmentResult] = await Promise.all([
    admin
      .from("schedule_school_bookings")
      .select("slot_id")
      .eq("application_id", applicationId),
    admin
      .from("adjudicator_assignments")
      .select("can_score,can_comment")
      .eq("application_id", applicationId)
      .eq("adjudicator_user_id", userId)
      .is("removed_at", null)
      .maybeSingle(),
  ]);

  if (bookingResult.error) throw new Error(bookingResult.error.message);
  if (assignmentResult.error) throw new Error(assignmentResult.error.message);

  const slotIds = (bookingResult.data ?? []).map((booking) => booking.slot_id);
  const shadowResult = slotIds.length
    ? await admin
        .from("schedule_slot_staff")
        .select("id")
        .in("slot_id", slotIds)
        .eq("user_id", userId)
        .eq("participation_mode", "shadow")
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };

  if (shadowResult.error) throw new Error(shadowResult.error.message);

  const scheduledShadow = Boolean(shadowResult.data);
  const readOnlyAssignment = Boolean(
    assignmentResult.data &&
      !assignmentResult.data.can_score &&
      !assignmentResult.data.can_comment,
  );

  return {
    allowed: scheduledShadow || readOnlyAssignment,
    scheduledShadow,
    readOnlyAssignment,
  };
}

export async function loadAdjudicationObserverSnapshot({
  admin,
  applicationId,
}: {
  admin: SupabaseClient;
  applicationId: string;
}): Promise<AdjudicationObserverSnapshot> {
  const [assignmentResult, proposalResult] = await Promise.all([
    admin
      .from("adjudicator_assignments")
      .select("id,adjudicator_user_id,assigned_at,can_score,can_comment")
      .eq("application_id", applicationId)
      .is("removed_at", null)
      .or("can_score.eq.true,can_comment.eq.true")
      .order("assigned_at")
      .order("id"),
    admin
      .from("adjudication_category_proposals")
      .select(
        "id,category_id,is_eligible,range_min,range_max,status,advisory_note",
      )
      .eq("application_id", applicationId)
      .neq("status", "draft"),
  ]);

  if (assignmentResult.error) throw new Error(assignmentResult.error.message);
  if (proposalResult.error) throw new Error(proposalResult.error.message);

  const assignments = assignmentResult.data ?? [];
  const panelUserIds = assignments.map(
    (assignment) => assignment.adjudicator_user_id,
  );
  const proposalIds = (proposalResult.data ?? []).map(
    (proposal) => proposal.id,
  );

  const [profileResult, scorecardResult, approvalResult] = await Promise.all([
    panelUserIds.length
      ? admin
          .from("profiles")
          .select("id,full_name")
          .in("id", panelUserIds)
      : Promise.resolve({ data: [], error: null }),
    panelUserIds.length
      ? admin
          .from("adjudication_scorecards")
          .select("id,adjudicator_user_id")
          .eq("application_id", applicationId)
          .in("adjudicator_user_id", panelUserIds)
      : Promise.resolve({ data: [], error: null }),
    proposalIds.length
      ? admin
          .from("adjudication_category_approvals")
          .select("proposal_id,adjudicator_user_id,response,comment")
          .in("proposal_id", proposalIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (scorecardResult.error) throw new Error(scorecardResult.error.message);
  if (approvalResult.error) throw new Error(approvalResult.error.message);

  const scorecards = scorecardResult.data ?? [];
  const scorecardIds = scorecards.map((scorecard) => scorecard.id);
  const scoreResult = scorecardIds.length
    ? await admin
        .from("adjudication_scores")
        .select("scorecard_id,criterion_id,observation,updated_at")
        .in("scorecard_id", scorecardIds)
    : { data: [], error: null };

  if (scoreResult.error) throw new Error(scoreResult.error.message);

  const panelRows = buildAdjudicationObserverPanelRows({
    assignments: assignments as ObserverAssignmentRow[],
    profiles: (profileResult.data ?? []) as ObserverProfileRow[],
    scorecards: scorecards as ObserverScorecardRow[],
    scores: (scoreResult.data ?? []) as ObserverScoreRow[],
  });

  return {
    panelRows,
    proposals: (proposalResult.data ?? []) as AdjudicationObserverProposal[],
    approvals: (approvalResult.data ?? []) as AdjudicationObserverApproval[],
  };
}
