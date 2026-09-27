import { describe, expect, it } from "vitest";

import {
  canSelfJoinScheduleSlot,
  scheduleStaffCapacity,
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

describe("schedule staff capacity", () => {
  it("counts adjudicator panel seats separately from the advisory member", () => {
    const capacity = scheduleStaffCapacity([
      { role: "adjudicator", participation_mode: "panel" },
      { role: "adjudicator", participation_mode: "panel" },
      { role: "adjudicator", participation_mode: "panel" },
      { role: "advisory_member", participation_mode: "panel" },
    ]);

    expect(capacity.adjudicators).toBe(3);
    expect(capacity.adjudicatorsFull).toBe(true);
  });

  it("caps one understudy and three shadows", () => {
    const capacity = scheduleStaffCapacity([
      { role: "adjudicator", participation_mode: "understudy" },
      { role: "adjudicator", participation_mode: "shadow" },
      { role: "adjudicator", participation_mode: "shadow" },
      { role: "adjudicator", participation_mode: "shadow" },
    ]);

    expect(capacity.understudiesFull).toBe(true);
    expect(capacity.shadowsFull).toBe(true);
  });
});
