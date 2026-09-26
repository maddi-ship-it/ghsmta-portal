import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCHEDULE_TRACK_FILTER,
  defaultScheduleFilter,
  resolveScheduleFilter,
  resolveScheduleTrackFilter,
  scheduleSlotMatchesTrack,
} from "./schedule-filters";

describe("resolveScheduleFilter", () => {
  it.each(["owner", "advisory_member", "adjudicator"] as const)(
    "defaults %s schedules to booked slots",
    (role) => {
      expect(resolveScheduleFilter(role, undefined)).toBe("booked");
    },
  );

  it.each(["applicant", "program_manager"] as const)(
    "keeps the existing all-slots default for %s schedules",
    (role) => {
      expect(resolveScheduleFilter(role, undefined)).toBe("all");
    },
  );

  it("preserves an explicit valid filter", () => {
    expect(resolveScheduleFilter("owner", "all")).toBe("all");
    expect(resolveScheduleFilter("adjudicator", "mine")).toBe("mine");
  });

  it("uses the role default when the filter is invalid", () => {
    expect(resolveScheduleFilter("advisory_member", "not-a-filter")).toBe("booked");
    expect(resolveScheduleFilter("applicant", "not-a-filter")).toBe("all");
  });

  it("exposes the role default for reset controls", () => {
    expect(defaultScheduleFilter("owner")).toBe("booked");
    expect(defaultScheduleFilter("applicant")).toBe("all");
  });
});

describe("schedule track filters", () => {
  it("defaults schedules to the competition track", () => {
    expect(DEFAULT_SCHEDULE_TRACK_FILTER).toBe("competition");
    expect(resolveScheduleTrackFilter(undefined)).toBe("competition");
    expect(resolveScheduleTrackFilter("not-a-track")).toBe("competition");
  });

  it("preserves explicit mentorship and all-track filters", () => {
    expect(resolveScheduleTrackFilter("mentorship")).toBe("mentorship");
    expect(resolveScheduleTrackFilter("all")).toBe("all");
  });

  it("recognizes mentorship slots without depending on capitalization", () => {
    expect(
      scheduleSlotMatchesTrack(
        "SATURDAY MATINEE- MENTORSHIP ONLY",
        "mentorship",
      ),
    ).toBe(true);
    expect(
      scheduleSlotMatchesTrack(
        "Saturday Matinee - Mentorship",
        "competition",
      ),
    ).toBe(false);
  });

  it("treats non-mentorship slots as competition slots", () => {
    expect(
      scheduleSlotMatchesTrack("FRIDAY EVENING (1)", "competition"),
    ).toBe(true);
    expect(scheduleSlotMatchesTrack("FRIDAY EVENING (1)", "all")).toBe(
      true,
    );
  });
});
