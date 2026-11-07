import type { AppRole } from "@/lib/types";

export const REQUIRED_ACM_COUNT = 1;
export const REQUIRED_ADJUDICATOR_COUNT = 3;

export type UpcomingAdjudication = {
  slotId: string;
  applicationId: string;
  schoolName: string;
  productionTitle: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  status: string;
  acmCount: number;
  adjudicatorCount: number;
  needsAcm: boolean;
  needsAdjudicators: boolean;
  currentUserJoined: boolean;
};

type ScheduleSlotRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  status: string;
};

type ScheduleBookingRow = {
  slot_id: string;
  application_id: string;
  approval_status: string;
};

type ApplicationRow = {
  id: string;
  school_name: string;
  production_title: string | null;
};

type ScheduleStaffRow = {
  slot_id: string;
  user_id: string;
  joined_as: AppRole;
  participation_mode: "panel" | "understudy" | "shadow";
};

export function buildUpcomingAdjudications({
  applications,
  bookings,
  currentUserId,
  limit = 6,
  slots,
  staff,
}: {
  applications: ApplicationRow[];
  bookings: ScheduleBookingRow[];
  currentUserId: string;
  limit?: number;
  slots: ScheduleSlotRow[];
  staff: ScheduleStaffRow[];
}): UpcomingAdjudication[] {
  const applicationById = new Map(
    applications.map((application) => [application.id, application]),
  );
  const bookingBySlotId = new Map(
    bookings
      .filter((booking) => booking.approval_status === "confirmed")
      .map((booking) => [booking.slot_id, booking]),
  );
  const staffBySlotId = new Map<string, ScheduleStaffRow[]>();

  for (const participant of staff) {
    const participants = staffBySlotId.get(participant.slot_id) ?? [];
    participants.push(participant);
    staffBySlotId.set(participant.slot_id, participants);
  }

  return slots
    .filter((slot) => slot.status !== "cancelled" && bookingBySlotId.has(slot.id))
    .sort(
      (left, right) =>
        new Date(left.starts_at).getTime() -
        new Date(right.starts_at).getTime(),
    )
    .flatMap((slot) => {
      const booking = bookingBySlotId.get(slot.id);
      if (!booking) return [];

      const application = applicationById.get(booking.application_id);
      if (!application) return [];

      const participants = staffBySlotId.get(slot.id) ?? [];
      const acmCount = participants.filter(
        (participant) =>
          participant.joined_as === "advisory_member" &&
          participant.participation_mode === "panel",
      ).length;
      const adjudicatorCount = participants.filter(
        (participant) =>
          participant.joined_as === "adjudicator" &&
          participant.participation_mode === "panel",
      ).length;

      return [
        {
          slotId: slot.id,
          applicationId: application.id,
          schoolName: application.school_name,
          productionTitle:
            application.production_title?.trim() || "Production title pending",
          startsAt: slot.starts_at,
          endsAt: slot.ends_at,
          location: slot.location,
          status: slot.status,
          acmCount,
          adjudicatorCount,
          needsAcm: acmCount < REQUIRED_ACM_COUNT,
          needsAdjudicators:
            adjudicatorCount < REQUIRED_ADJUDICATOR_COUNT,
          currentUserJoined: participants.some(
            (participant) => participant.user_id === currentUserId,
          ),
        },
      ];
    })
    .slice(0, limit);
}
