import type { AppRole } from "@/lib/types";

export const SCHEDULE_FILTERS = [
  "all",
  "open",
  "booked",
  "unbooked",
  "waitlisted",
  "understaffed",
  "mine",
] as const;

export type ScheduleFilter = (typeof SCHEDULE_FILTERS)[number];

export const SCHEDULE_TRACK_FILTERS = [
  "competition",
  "mentorship",
  "all",
] as const;

export type ScheduleTrackFilter =
  (typeof SCHEDULE_TRACK_FILTERS)[number];

export const DEFAULT_SCHEDULE_TRACK_FILTER: ScheduleTrackFilter =
  "competition";

const BOOKED_BY_DEFAULT_ROLES: ReadonlySet<AppRole> = new Set([
  "owner",
  "advisory_member",
  "adjudicator",
]);

export function defaultScheduleFilter(role: AppRole): ScheduleFilter {
  return BOOKED_BY_DEFAULT_ROLES.has(role) ? "booked" : "all";
}

export function resolveScheduleFilter(
  role: AppRole,
  requestedFilter: string | undefined,
): ScheduleFilter {
  if (SCHEDULE_FILTERS.some((filter) => filter === requestedFilter)) {
    return requestedFilter as ScheduleFilter;
  }

  return defaultScheduleFilter(role);
}

export function resolveScheduleTrackFilter(
  requestedTrack: string | undefined,
): ScheduleTrackFilter {
  if (SCHEDULE_TRACK_FILTERS.some((track) => track === requestedTrack)) {
    return requestedTrack as ScheduleTrackFilter;
  }

  return DEFAULT_SCHEDULE_TRACK_FILTER;
}

export function scheduleSlotMatchesTrack(
  slotTitle: string,
  track: ScheduleTrackFilter,
) {
  if (track === "all") return true;

  const isMentorship = slotTitle.toLowerCase().includes("mentor");
  return track === "mentorship" ? isMentorship : !isMentorship;
}
