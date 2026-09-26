import { describe, expect, it } from "vitest";

import {
  defaultScheduleFilter,
  resolveScheduleFilter,
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
