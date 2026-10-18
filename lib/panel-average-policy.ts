import type {
  AdjudicatorAssignment,
  Profile,
} from "@/lib/types";

const STANDARD_ADJUDICATOR_PANEL_SIZE = 3;

export type PanelAveragePolicy = {
  contributorUserIds: Set<string>;
  referenceUserIds: Set<string>;
  adjudicatorOnly: boolean;
  contributorCount: number;
};

export function resolvePanelAveragePolicy(
  assignments: Array<
    Pick<AdjudicatorAssignment, "adjudicator_user_id" | "can_score">
  >,
  profiles: Array<Pick<Profile, "id" | "role">>,
): PanelAveragePolicy {
  const roleByUserId = new Map(
    profiles.map((profile) => [profile.id, profile.role]),
  );
  const scoringUserIds = new Set(
    assignments
      .filter((assignment) => assignment.can_score !== false)
      .map((assignment) => assignment.adjudicator_user_id),
  );
  const adjudicatorUserIds = new Set(
    [...scoringUserIds].filter(
      (userId) => roleByUserId.get(userId) === "adjudicator",
    ),
  );
  const adjudicatorOnly =
    adjudicatorUserIds.size >= STANDARD_ADJUDICATOR_PANEL_SIZE;
  const contributorUserIds = adjudicatorOnly
    ? adjudicatorUserIds
    : scoringUserIds;
  const referenceUserIds = new Set(
    [...scoringUserIds].filter(
      (userId) => !contributorUserIds.has(userId),
    ),
  );

  return {
    contributorUserIds,
    referenceUserIds,
    adjudicatorOnly,
    contributorCount: contributorUserIds.size,
  };
}
