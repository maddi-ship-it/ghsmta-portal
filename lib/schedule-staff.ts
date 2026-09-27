import type { AppRole } from "@/lib/types";

type ScheduleParticipant = {
  role: AppRole;
  participation_mode?: "panel" | "understudy" | "shadow";
};

export const SCHEDULE_STAFF_LIMITS = {
  adjudicators: 3,
  understudies: 1,
  shadows: 3,
} as const;

export function scheduleStaffCapacity(
  participants: ScheduleParticipant[],
) {
  const adjudicators = participants.filter(
    (participant) =>
      participant.role === "adjudicator" &&
      participant.participation_mode === "panel",
  ).length;
  const understudies = participants.filter(
    (participant) => participant.participation_mode === "understudy",
  ).length;
  const shadows = participants.filter(
    (participant) => participant.participation_mode === "shadow",
  ).length;

  return {
    adjudicators,
    understudies,
    shadows,
    adjudicatorsFull: adjudicators >= SCHEDULE_STAFF_LIMITS.adjudicators,
    understudiesFull: understudies >= SCHEDULE_STAFF_LIMITS.understudies,
    shadowsFull: shadows >= SCHEDULE_STAFF_LIMITS.shadows,
  };
}

export function scheduleSlotHasAdvisoryMember(
  participants: ScheduleParticipant[],
) {
  return participants.some(
    (participant) => participant.role === "advisory_member",
  );
}

export function canSelfJoinScheduleSlot({
  currentEnrollment,
  isPast,
  participants,
  role,
  status,
}: {
  currentEnrollment: boolean;
  isPast: boolean;
  participants: ScheduleParticipant[];
  role: AppRole;
  status: string;
}) {
  if (status !== "open" || isPast || currentEnrollment) return false;

  return !(
    role === "advisory_member" &&
    scheduleSlotHasAdvisoryMember(participants)
  );
}
