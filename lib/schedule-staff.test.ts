import { describe, expect, it } from "vitest";

import {
  canSelfJoinScheduleSlot,
  scheduleSlotHasAdvisoryMember,
} from "./schedule-staff";

const advisoryParticipant = [{ role: "advisory_member" as const }];

describe("schedule advisory capacity", () => {
  it("detects an advisory member already assigned to a slot", () => {
    expect(scheduleSlotHasAdvisoryMember(advisoryParticipant)).toBe(true);
  });

  it("prevents a second advisory member from self-enrolling", () => {
    expect(
      canSelfJoinScheduleSlot({
        currentEnrollment: false,
        isPast: false,
        participants: advisoryParticipant,
        role: "advisory_member",
        status: "open",
      }),
    ).toBe(false);
  });

  it("still allows adjudicators to join when the advisory seat is filled", () => {
    expect(
      canSelfJoinScheduleSlot({
        currentEnrollment: false,
        isPast: false,
        participants: advisoryParticipant,
        role: "adjudicator",
        status: "open",
      }),
    ).toBe(true);
  });
});
