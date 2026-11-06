import type { AppRole } from "@/lib/types";

type ScheduleParticipant = {
  role: AppRole;
  participation_mode?: "panel" | "understudy" | "shadow";
};

export type ScheduleObserverMode = "understudy" | "shadow";

type ScheduleObserverBooking = {
  slot_id: string;
  application_id: string;
};

type ScheduleObserverStaff = {
  slot_id: string;
  user_id: string;
  participation_mode: "panel" | ScheduleObserverMode;
};

export const SCHEDULE_STAFF_LIMITS = {
  adjudicators: 3,
  understudies: 1,
  shadows: 3,
} as const;

export function scheduleObserverModesByApplication({
  bookings,
  staff,
  userId,
}: {
  bookings: ScheduleObserverBooking[];
  staff: ScheduleObserverStaff[];
  userId: string;
}) {
  const observerModeBySlotId = new Map<string, ScheduleObserverMode>();

  for (const participant of staff) {
    if (
      participant.user_id !== userId ||
      participant.participation_mode === "panel"
    ) {
      continue;
    }

    observerModeBySlotId.set(
      participant.slot_id,
      participant.participation_mode,
    );
  }

  const observerModeByApplicationId = new Map<
    string,
    ScheduleObserverMode
  >();
  for (const booking of bookings) {
    const observerMode = observerModeBySlotId.get(booking.slot_id);
    if (!observerMode) continue;

    const existingMode = observerModeByApplicationId.get(
      booking.application_id,
    );
    if (!existingMode || observerMode === "shadow") {
      observerModeByApplicationId.set(
        booking.application_id,
        observerMode,
      );
    }
  }

  return observerModeByApplicationId;
}

export function scheduleStaffCapacity(
  participants: ScheduleParticipant[],
) {
  const advisoryMembers = participants.filter(
    (participant) => participant.role === "advisory_member",
  ).length;
  const primaryAdvisoryMembers = participants.filter(
    (participant) =>
      participant.role === "advisory_member" &&
      participant.participation_mode !== "shadow",
  ).length;
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
    advisoryMembers,
    primaryAdvisoryMembers,
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

export function scheduleSlotHasPrimaryAdvisoryMember(
  participants: ScheduleParticipant[],
) {
  return participants.some(
    (participant) =>
      participant.role === "advisory_member" &&
      participant.participation_mode !== "shadow",
  );
}

export function canScheduleParticipantUseMode({
  participants,
  role,
  participationMode,
}: {
  participants: ScheduleParticipant[];
  role: AppRole;
  participationMode: "panel" | "understudy" | "shadow";
}) {
  const capacity = scheduleStaffCapacity(participants);

  if (role === "advisory_member") {
    if (participationMode === "shadow") return !capacity.shadowsFull;
    if (scheduleSlotHasPrimaryAdvisoryMember(participants)) return false;
  }

  if (participationMode === "panel") {
    return role !== "adjudicator" || !capacity.adjudicatorsFull;
  }

  if (participationMode === "understudy") {
    return !capacity.understudiesFull;
  }

  return !capacity.shadowsFull;
}

export function canSelfJoinScheduleSlot({
  currentEnrollment,
  isPast,
  participants,
  role,
  status,
  participationMode,
}: {
  currentEnrollment: boolean;
  isPast: boolean;
  participants: ScheduleParticipant[];
  role: AppRole;
  status: string;
  participationMode: "panel" | "understudy" | "shadow";
}) {
  if (status !== "open" || isPast || currentEnrollment) return false;

  return canScheduleParticipantUseMode({
    participants,
    role,
    participationMode,
  });
}
