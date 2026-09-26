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
