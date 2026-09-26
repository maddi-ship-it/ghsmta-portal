import type { AppRole } from "@/lib/types";

type ScheduleParticipant = {
  role: AppRole;
};

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
