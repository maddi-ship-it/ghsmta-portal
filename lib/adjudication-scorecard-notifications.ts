import { createHash } from "node:crypto";

import type { AppRole } from "@/lib/types";

export type ScorecardNotificationAssignment = {
  id: string;
  adjudicator_user_id: string;
  can_score: boolean | null;
  participant_role: string | null;
  removed_at: string | null;
};

export type ScorecardNotificationProfile = {
  id: string;
  role: AppRole;
};

export type ScorecardNotificationScorecard = {
  assignment_id: string;
  status: string;
  submitted_at: string | null;
};

export function activeAdjudicatorAssignmentIds({
  assignments,
  profiles,
}: {
  assignments: ScorecardNotificationAssignment[];
  profiles: ScorecardNotificationProfile[];
}) {
  const roleByUserId = new Map(
    profiles.map((profile) => [profile.id, profile.role]),
  );

  return assignments
    .filter(
      (assignment) =>
        assignment.removed_at == null &&
        assignment.can_score === true &&
        (assignment.participant_role ??
          roleByUserId.get(assignment.adjudicator_user_id)) === "adjudicator",
    )
    .map((assignment) => assignment.id);
}

export function submittedAdjudicatorScorecards({
  assignmentIds,
  scorecards,
}: {
  assignmentIds: string[];
  scorecards: ScorecardNotificationScorecard[];
}) {
  const requiredAssignmentIds = new Set(assignmentIds);
  const submittedByAssignmentId = new Map(
    scorecards
      .filter(
        (scorecard) =>
          requiredAssignmentIds.has(scorecard.assignment_id) &&
          ["submitted", "locked"].includes(scorecard.status) &&
          Boolean(scorecard.submitted_at),
      )
      .map((scorecard) => [scorecard.assignment_id, scorecard]),
  );

  if (
    assignmentIds.length === 0 ||
    assignmentIds.some(
      (assignmentId) => !submittedByAssignmentId.has(assignmentId),
    )
  ) {
    return [];
  }

  return assignmentIds.map(
    (assignmentId) => submittedByAssignmentId.get(assignmentId)!,
  );
}

function deterministicUuid(value: string) {
  const characters = createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 32)
    .split("");
  characters[12] = "5";
  characters[16] = (
    (Number.parseInt(characters[16], 16) & 0x3) |
    0x8
  ).toString(16);
  const hex = characters.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function scorecardSubmissionMilestoneId({
  applicationId,
  scorecards,
}: {
  applicationId: string;
  scorecards: ScorecardNotificationScorecard[];
}) {
  const fingerprint = scorecards
    .map(
      (scorecard) =>
        `${scorecard.assignment_id}:${scorecard.submitted_at ?? scorecard.status}`,
    )
    .sort()
    .join("|");
  return deterministicUuid(`scorecards-submitted:${applicationId}:${fingerprint}`);
}

export function scorecardSubmissionOwnerNotificationId({
  ownerId,
  scorecardId,
  submittedAt,
}: {
  ownerId: string;
  scorecardId: string;
  submittedAt: string;
}) {
  return deterministicUuid(
    `scorecard-submitted:${ownerId}:${scorecardId}:${submittedAt}`,
  );
}

export function scorecardSubmittedOwnerNotificationBody({
  adjudicatorName,
  schoolName,
  productionTitle,
}: {
  adjudicatorName: string;
  schoolName: string;
  productionTitle: string | null | undefined;
}) {
  const productionLabel = productionTitle?.trim()
    ? ` — ${productionTitle.trim()}`
    : "";
  return `${adjudicatorName} submitted their scorecard for ${schoolName}${productionLabel}.`;
}

export function allScorecardsSubmittedPanelAnnouncement({
  schoolName,
  productionTitle,
  adjudicatorCount,
}: {
  schoolName: string;
  productionTitle: string | null | undefined;
  adjudicatorCount: number;
}) {
  const productionLabel = productionTitle?.trim()
    ? ` — ${productionTitle.trim()}`
    : "";
  return (
    `All ${adjudicatorCount} adjudicator scorecards have been submitted for ${schoolName}${productionLabel}.\n\n` +
    "The panel is ready for final comment generation."
  );
}
