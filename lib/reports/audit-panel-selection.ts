import { resolvePanelAveragePolicy } from "@/lib/panel-average-policy";
import type { Profile } from "@/lib/types";

export type AuditPanelAssignment = {
  id: string;
  adjudicator_user_id: string;
  can_score?: boolean | null;
  participant_role?: string | null;
  removed_at?: string | null;
};

export type AuditPanelScorecard = {
  id: string;
  assignment_id: string;
  status?: string | null;
  submitted_at?: string | null;
};

type AuditPanelSelectionInput = {
  assignments: AuditPanelAssignment[];
  scorecards: AuditPanelScorecard[];
  scoreCountByScorecardId: Map<string, number>;
  profileRoleByUserId: Map<string, string | null | undefined>;
};

function scorecardEvidence(
  scorecard: AuditPanelScorecard | undefined,
  scoreCountByScorecardId: Map<string, number>,
) {
  if (!scorecard) return false;
  return (
    (scoreCountByScorecardId.get(scorecard.id) ?? 0) > 0 ||
    Boolean(scorecard.submitted_at) ||
    scorecard.status === "submitted" ||
    scorecard.status === "locked"
  );
}

/**
 * Resolve the panelists whose scores belong in the external audit workbook.
 *
 * An adjudicator's completed scorecard remains part of the audit record even
 * if their live-panel assignment is later removed. School-specific assignment
 * roles are authoritative because a person's account-wide role can differ from
 * the role they held on a particular panel.
 */
export function selectAuditPanelAssignments({
  assignments,
  scorecards,
  scoreCountByScorecardId,
  profileRoleByUserId,
}: AuditPanelSelectionInput) {
  const scorecardByAssignmentId = new Map(
    scorecards.map((scorecard) => [scorecard.assignment_id, scorecard]),
  );
  const candidateAssignments = assignments.filter((assignment) => {
    if (assignment.can_score === false) return false;
    if (!assignment.removed_at) return true;
    return scorecardEvidence(
      scorecardByAssignmentId.get(assignment.id),
      scoreCountByScorecardId,
    );
  });

  const assignmentByUserId = new Map<string, AuditPanelAssignment>();
  for (const assignment of candidateAssignments) {
    const current = assignmentByUserId.get(assignment.adjudicator_user_id);
    if (!current) {
      assignmentByUserId.set(assignment.adjudicator_user_id, assignment);
      continue;
    }

    const assignmentCard = scorecardByAssignmentId.get(assignment.id);
    const currentCard = scorecardByAssignmentId.get(current.id);
    const assignmentScoreCount = assignmentCard
      ? scoreCountByScorecardId.get(assignmentCard.id) ?? 0
      : 0;
    const currentScoreCount = currentCard
      ? scoreCountByScorecardId.get(currentCard.id) ?? 0
      : 0;
    const assignmentPriority =
      assignmentScoreCount * 10 +
      (scorecardEvidence(assignmentCard, scoreCountByScorecardId) ? 2 : 0) +
      (!assignment.removed_at ? 1 : 0);
    const currentPriority =
      currentScoreCount * 10 +
      (scorecardEvidence(currentCard, scoreCountByScorecardId) ? 2 : 0) +
      (!current.removed_at ? 1 : 0);

    if (assignmentPriority > currentPriority) {
      assignmentByUserId.set(assignment.adjudicator_user_id, assignment);
    }
  }

  const deduplicatedAssignments = [...assignmentByUserId.values()];
  const panelProfiles = deduplicatedAssignments.map((assignment) => ({
    id: assignment.adjudicator_user_id,
    role: (assignment.participant_role ??
      profileRoleByUserId.get(assignment.adjudicator_user_id) ??
      "adjudicator") as Profile["role"],
  }));
  const panelPolicy = resolvePanelAveragePolicy(
    deduplicatedAssignments.map((assignment) => ({
      adjudicator_user_id: assignment.adjudicator_user_id,
      can_score: assignment.can_score ?? undefined,
    })),
    panelProfiles,
  );

  return deduplicatedAssignments.filter((assignment) =>
    panelPolicy.contributorUserIds.has(assignment.adjudicator_user_id),
  );
}
