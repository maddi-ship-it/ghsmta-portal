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

export const SCHEDULE_TIME_ZONE = "America/New_York";

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

export function resolveScheduleDateFilter(requestedDate: string | undefined) {
  if (!requestedDate) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(requestedDate);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return requestedDate;
}

export function scheduleDateKey(
  startsAt: string,
  timeZone = SCHEDULE_TIME_ZONE,
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date(startsAt))
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function scheduleSlotMatchesDate(
  startsAt: string,
  selectedDate: string | null,
) {
  return !selectedDate || scheduleDateKey(startsAt) === selectedDate;
}
