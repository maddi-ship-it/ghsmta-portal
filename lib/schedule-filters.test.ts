import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCHEDULE_TRACK_FILTER,
  defaultScheduleFilter,
  defaultScheduleTrackFilter,
  resolveScheduleDateFilter,
  resolveScheduleFilter,
  resolveScheduleTrackFilter,
  scheduleDateKey,
  scheduleSlotMatchesDate,
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
  it("keeps competition as the owner and applicant default", () => {
    expect(DEFAULT_SCHEDULE_TRACK_FILTER).toBe("competition");
    expect(defaultScheduleTrackFilter("owner")).toBe("competition");
    expect(resolveScheduleTrackFilter("applicant", undefined)).toBe("competition");
    expect(resolveScheduleTrackFilter("owner", "not-a-track")).toBe("competition");
  });

  it.each(["advisory_member", "adjudicator"] as const)(
    "shows booked slots from every track by default for %s",
    (role) => {
      expect(defaultScheduleTrackFilter(role)).toBe("all");
      expect(resolveScheduleTrackFilter(role, undefined)).toBe("all");
    },
  );

  it("preserves explicit competition filters for reviewers", () => {
    expect(resolveScheduleTrackFilter("adjudicator", "competition")).toBe(
      "competition",
    );
  });

  it("preserves explicit mentorship and all-track filters", () => {
    expect(resolveScheduleTrackFilter("owner", "mentorship")).toBe("mentorship");
    expect(resolveScheduleTrackFilter("owner", "all")).toBe("all");
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

describe("schedule date filters", () => {
  it("accepts real calendar dates and rejects malformed or impossible dates", () => {
    expect(resolveScheduleDateFilter("2026-09-04")).toBe("2026-09-04");
    expect(resolveScheduleDateFilter("09/04/2026")).toBeNull();
    expect(resolveScheduleDateFilter("2026-02-30")).toBeNull();
    expect(resolveScheduleDateFilter(undefined)).toBeNull();
  });

  it("uses the Eastern calendar date rather than the UTC date", () => {
    expect(scheduleDateKey("2026-09-05T02:00:00.000Z")).toBe("2026-09-04");
    expect(
      scheduleSlotMatchesDate("2026-09-05T02:00:00.000Z", "2026-09-04"),
    ).toBe(true);
    expect(
      scheduleSlotMatchesDate("2026-09-05T02:00:00.000Z", "2026-09-05"),
    ).toBe(false);
  });

  it("does not filter slots when no date is selected", () => {
    expect(scheduleSlotMatchesDate("2026-09-05T02:00:00.000Z", null)).toBe(
      true,
    );
  });
});
